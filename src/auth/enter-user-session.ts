import { recordTimingLog } from "../data/sqlite/timing-logger";
import type { Library } from "../types/absTypes";
import { AuthError, authService } from "./auth-service";
import { authStore } from "./auth-store";
import {
  authStorage,
  getDefaultSessionLabel,
  getSessionKey,
  type RememberedSessionRecord,
  type SessionSecrets,
} from "./auth-storage";
import { fetchLibrariesForResolution, resolveLibrarySelection } from "./library-resolution";
import { prepareForSignInChange } from "./session-boundary";

/**
 * User Session Entry (ADR-0020). Establishes the signed-in User Session from either
 * Session Restoration ("restore") or credential submission ("credentials").
 *
 * The phases run in a fixed order so a failed or interrupted entry never leaves the
 * user worse off than before they tried:
 *   1. authenticate   confirm the Audiobookshelf User Identity over the network
 *   2. persist        save the new Remembered User Session, inactive
 *   3. crossBoundary  capture the previous identity's listening state, tear down live state
 *   4. commit         make the new session active — the single atomic switch-over
 *   5. resolve        decide the Active Library and return a Session Entry Resolution
 *
 * The module is navigation-free: it returns a SessionEntryResolution and the caller maps
 * it to routes and runs Library Activation.
 */
export type UserSessionEntryRequest =
  | { via: "restore"; sessionKey: string }
  | {
      via: "credentials";
      username: string;
      password: string;
      serverUrl: string;
      label?: string | null;
      color?: string | null;
    };

export type SessionEntryFailureKind = "offline" | "needsAttention" | "unexpected";

export type SessionEntryResolution =
  | { outcome: "activate"; library: Library }
  | { outcome: "needsLibrarySelection" }
  | { outcome: "noLibraries"; message: string }
  | {
      outcome: "failed";
      kind: SessionEntryFailureKind;
      message: string;
      sessionKey?: string;
    };

const isNetworkError = (error: unknown) =>
  error instanceof AuthError && error.code === "NETWORK_ERROR";

const toMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

// Phase 1 (restore): obtain valid tokens via remembered refresh token, then remembered
// password as a fallback. A NETWORK_ERROR propagates so the caller reports offline; any
// other failure resolves to null so the entry surfaces as "needs attention". Returns null
// when neither path yields tokens.
const authenticateRestore = async (
  session: RememberedSessionRecord,
  secrets: SessionSecrets,
): Promise<{ accessToken: string; refreshToken: string } | null> => {
  let tokens: { accessToken: string; refreshToken: string } | null = null;

  if (secrets.refreshToken) {
    try {
      tokens = await authService.refresh(session.serverUrl, secrets.refreshToken);
    } catch (error) {
      if (isNetworkError(error)) throw error;
      tokens = null;
    }
  }

  if (!tokens && secrets.password) {
    try {
      const loginResult = await authService.login({
        username: session.username,
        password: secrets.password,
        serverUrl: session.serverUrl,
      });
      if (loginResult.userId !== session.userId) {
        throw new AuthError(
          "Sign-in returned a different Audiobookshelf user",
          "INVALID_RESPONSE",
        );
      }
      tokens = {
        accessToken: loginResult.accessToken,
        refreshToken: loginResult.refreshToken,
      };
    } catch (error) {
      if (isNetworkError(error)) throw error;
      tokens = null;
    }
  }

  return tokens;
};

type ConfirmedIdentity = {
  sessionKey: string;
  confirmedUserId: string;
  username: string;
  serverUrl: string;
  tokens: { accessToken: string; refreshToken: string };
  hasPassword: boolean;
  // The remembered Active Library used only as a resolution hint (auto-activate vs ask).
  libraryHint: string | null;
};

const runEntry = async (req: UserSessionEntryRequest): Promise<SessionEntryResolution> => {
  const startedAt = Date.now();
  const timingLabel =
    req.via === "restore" ? "restore_remembered_session" : "login_with_password";

  const before = authStore.getState();
  if (before.isOnline === false) {
    return {
      outcome: "failed",
      kind: "offline",
      message: "You are offline. Connect to the internet to sign in.",
    };
  }

  const prevUserId = before.storedUserId;
  const prevActiveLibraryId = before.activeLibraryId;

  // ---- Phase 1: authenticate (+ persist the credentials path's record) ----
  let identity: ConfirmedIdentity;
  try {
    if (req.via === "restore") {
      const session = authStorage
        .getSessionsSnapshot()
        .sessions.find((item) => item.key === req.sessionKey);
      if (!session) {
        return {
          outcome: "failed",
          kind: "unexpected",
          message: "Sign-in entry not found.",
        };
      }

      const secrets = await authStorage.getSessionSecrets(session.key);
      const restored = await authenticateRestore(session, secrets);
      if (!restored) {
        authStore.getState().actions.setSessionNeedsAttention(session.key, "Sign in needed");
        return {
          outcome: "failed",
          kind: "needsAttention",
          message: "Sign in needed",
          sessionKey: session.key,
        };
      }

      const isSameUser = Boolean(prevUserId && prevUserId === session.userId);
      identity = {
        sessionKey: session.key,
        confirmedUserId: session.userId,
        username: session.username,
        serverUrl: session.serverUrl,
        tokens: restored,
        hasPassword: Boolean(secrets.password),
        libraryHint: session.activeLibraryId ?? (isSameUser ? prevActiveLibraryId : null),
      };
    } else {
      const normalizedServerUrl = authService.normalizeServerUrl(req.serverUrl);
      const loginResult = await authService.login({
        username: req.username,
        password: req.password,
        serverUrl: normalizedServerUrl,
      });
      const sessionKey = getSessionKey(req.username, normalizedServerUrl);

      // Phase 2 (credentials): persist the record + secrets, but do not make it active.
      authStorage.upsertSession(
        {
          userId: loginResult.userId,
          username: req.username,
          serverUrl: normalizedServerUrl,
          label: req.label?.trim() || getDefaultSessionLabel(req.username, normalizedServerUrl),
          color: req.color ?? null,
          needsAttention: false,
          lastError: null,
        },
        { makeActive: false },
      );
      await authStorage.setSessionSecrets(sessionKey, {
        password: req.password,
        accessToken: loginResult.accessToken,
        refreshToken: loginResult.refreshToken,
      });

      identity = {
        sessionKey,
        confirmedUserId: loginResult.userId,
        username: req.username,
        serverUrl: normalizedServerUrl,
        tokens: {
          accessToken: loginResult.accessToken,
          refreshToken: loginResult.refreshToken,
        },
        hasPassword: true,
        libraryHint: null,
      };
    }
  } catch (error) {
    const message = toMessage(error, "Sign in failed");
    void recordTimingLog("login", timingLabel, startedAt, {
      success: false,
      error: message,
    });
    return {
      outcome: "failed",
      kind: isNetworkError(error) ? "offline" : "unexpected",
      message,
    };
  }

  // ---- Phase 2 (restore): persist refreshed tokens, clear attention ----
  // ---- Phase 3: cross the boundary  ---- Phase 4: make active ----
  try {
    if (req.via === "restore") {
      await authStorage.setSessionSecrets(identity.sessionKey, {
        accessToken: identity.tokens.accessToken,
        refreshToken: identity.tokens.refreshToken,
      });
      authStorage.updateSession(identity.sessionKey, {
        needsAttention: false,
        lastError: null,
      });
    }

    await prepareForSignInChange({
      userId: identity.confirmedUserId,
      sessionKey: identity.sessionKey,
    });

    authStore.getState().actions.commitActiveSession(identity.sessionKey, {
      accessToken: identity.tokens.accessToken,
      refreshToken: identity.tokens.refreshToken,
      hasPassword: identity.hasPassword,
    });
  } catch (error) {
    const message = toMessage(error, "Sign in failed");
    void recordTimingLog("login", timingLabel, startedAt, {
      success: false,
      error: message,
    });
    return {
      outcome: "failed",
      kind: "unexpected",
      message,
      sessionKey: identity.sessionKey,
    };
  }

  void recordTimingLog("login", timingLabel, startedAt, {
    username: identity.username,
    serverUrl: identity.serverUrl,
    success: true,
  });

  // ---- Phase 5: resolve the Active Library ----
  try {
    const userKey = authStore.getState().activeLibraryUserKey;
    const response = await fetchLibrariesForResolution(userKey);
    const resolution = resolveLibrarySelection(response.libraries, identity.libraryHint);

    if (resolution.status === "noLibraries") {
      return {
        outcome: "noLibraries",
        message: "This Audiobookshelf user does not have any libraries available.",
      };
    }
    if (resolution.status === "needsLibrarySelection") {
      return { outcome: "needsLibrarySelection" };
    }
    return { outcome: "activate", library: resolution.library };
  } catch (error) {
    return {
      outcome: "failed",
      kind: "unexpected",
      message: toMessage(error, "Could not load libraries."),
      sessionKey: identity.sessionKey,
    };
  }
};

let entryInFlight: Promise<SessionEntryResolution> | null = null;

/**
 * Owns the "only one User Session Entry at a time" rule. A second call while one is
 * running resolves to a failure rather than racing the in-flight entry.
 */
export const enterUserSession = (
  req: UserSessionEntryRequest,
): Promise<SessionEntryResolution> => {
  if (entryInFlight) {
    return Promise.resolve({
      outcome: "failed",
      kind: "unexpected",
      message: "A sign-in is already in progress.",
    });
  }
  entryInFlight = runEntry(req).finally(() => {
    entryInFlight = null;
  });
  return entryInFlight;
};

// Exported for tests only.
export const __testing = { authenticateRestore };
