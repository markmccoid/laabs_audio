import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { mmkvStorage } from "../store/mmkv-storage";
import { logStartupDuration, logStartupEvent, markStartup } from "../utils/dev-startup-tracing";
import { AuthError, authService } from "./auth-service";
import {
  authStorage,
  getDefaultSessionLabel,
  type RememberedSessionRecord,
} from "./auth-storage";
import { getJwtExpiry, isTokenExpired } from "./auth-token";
import { setAuthErrorHandler } from "../api/abs-client";
import { setAuthProvider } from "../api/auth-fetch";
import type { ServerConnectionStatus } from "./server-connection";

const log = (...args: unknown[]) => {
  if (__DEV__) {
  }
};

export type AuthStatus = "hydrating" | "anonymous" | "authenticated" | "offlineOnly";

export type AccessMode =
  | "hydrating"
  | "firstRunSignInRequired"
  | "downloadedOnly"
  | "downloadedSessionOnly"
  | "serverSetup"
  | "serverBrowsing";

export type AuthState = {
  status: AuthStatus;
  hasStoredCredentials: boolean;
  hasOfflineContent: boolean;
  isOnline: boolean | null;
  serverConnectionStatus: ServerConnectionStatus;
  storedUsername: string | null;
  storedUserId: string | null;
  serverUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
  lastAuthError: string | null;
  loginRequired: boolean;
  rememberedSessions: RememberedSessionRecord[];
  activeSessionKey: string | null;
  activeLibraryId: string | null;
  activeLibraryName: string | null;
  activeLibraryUserKey: string | null;
  /** ABS library mediaType for the Active Library (`book` | `podcast`). */
  activeLibraryMediaType: string | null;
  /**
   * True after media-specific activation has completed. Remembered podcast
   * Libraries deliberately re-enter as unready until their index is usable.
   */
  activeLibraryReady: boolean;
  actions: {
    hydrateFromStorage: (initialOfflineContent?: boolean) => Promise<void>;
    setOnlineStatus: (isOnline: boolean) => void;
    setServerConnectionStatus: (status: ServerConnectionStatus) => void;
    setHasOfflineContent: (hasOfflineContent: boolean) => void;
    setLoginRequired: (required: boolean, message?: string | null) => void;
    setActiveLibrary: (library: {
      id: string;
      name: string;
      mediaType?: string | null;
    }) => void;
    clearActiveLibrary: () => void;
    commitActiveSession: (
      sessionKey: string,
      secrets: { accessToken: string; refreshToken: string; hasPassword: boolean },
    ) => void;
    setSessionNeedsAttention: (sessionKey: string, message: string) => void;
    updateRememberedSession: (
      sessionKey: string,
      values: { label?: string | null; password?: string | null; color?: string | null },
    ) => Promise<void>;
    removeRememberedSession: (sessionKey: string) => Promise<void>;
    refreshSession: (options?: { force?: boolean }) => Promise<string | null>;
    logout: () => Promise<void>;
  };
};

const computeEntryStatus = (hasSession: boolean, hasOfflineContent: boolean): AuthStatus => {
  if (hasSession) return "authenticated";
  if (hasOfflineContent) return "offlineOnly";
  return "anonymous";
};

const getHasStoredSession = (state: {
  hasStoredCredentials: boolean;
  accessToken: string | null;
  refreshToken: string | null;
}) => Boolean(state.hasStoredCredentials || state.refreshToken || state.accessToken);

const getUserKey = (userId: string | null | undefined) => userId?.trim() || null;

let refreshPromise: Promise<string | null> | null = null;
// Single-flight guard for hydrateFromStorage: the headless CarPlay bootstrap
// (src/carplay/carplay-init.ts) and useAuthBootstrap's effect can both call it
// around startup; concurrent runs would interleave their set()s. Later calls
// (e.g. on hasOfflineContent changes) still re-hydrate once the prior run
// finishes. See docs/carplay-cold-start-streaming.md.
let hydratePromise: Promise<void> | null = null;

export const authStore = createStore<AuthState>()(
  persist(
    (set, get) => ({
      status: "hydrating",
      hasStoredCredentials: false,
      hasOfflineContent: false,
      isOnline: null,
      serverConnectionStatus: "unknown",
      storedUsername: null,
      storedUserId: null,
      serverUrl: null,
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      lastAuthError: null,
      loginRequired: false,
      rememberedSessions: [],
      activeSessionKey: null,
      activeLibraryId: null,
      activeLibraryName: null,
      activeLibraryUserKey: null,
      activeLibraryMediaType: null,
      activeLibraryReady: false,
      actions: {
        hydrateFromStorage: async (initialOfflineContent) => {
          if (hydratePromise) return hydratePromise;
          const run = async () => {
          const isInitialHydrate = get().status === "hydrating";
          const hydrateStartedAtMs = isInitialHydrate ? markStartup("auth-hydrate-start") : null;
          if (isInitialHydrate) {
            logStartupEvent("auth hydrate start", {
              hasOfflineContentHint: initialOfflineContent ?? null,
            });
          }

          log("hydrate:start");
          try {
          const snapshot = await authStorage.migrateLegacySessionIfNeeded();
          const activeSession = snapshot.sessions.find(
            (session) => session.key === snapshot.activeSessionKey,
          );
          const secrets = activeSession
            ? await authStorage.getSessionSecrets(activeSession.key)
            : { password: null, accessToken: null, refreshToken: null };

          const hasStoredCredentials = Boolean(activeSession && secrets.password);
          const accessTokenExpiresAt = getJwtExpiry(secrets.accessToken);
          const offlineContent =
            typeof initialOfflineContent === "boolean"
              ? initialOfflineContent
              : get().hasOfflineContent;
          const hasStoredSession = getHasStoredSession({
            hasStoredCredentials,
            accessToken: secrets.accessToken,
            refreshToken: secrets.refreshToken,
          });
          const userKey = getUserKey(activeSession?.userId);
          const persistedActiveLibraryId =
            userKey && get().activeLibraryUserKey === userKey ? get().activeLibraryId : null;
          const persistedActiveLibraryName =
            userKey && get().activeLibraryUserKey === userKey ? get().activeLibraryName : null;
          const persistedActiveLibraryMediaType =
            userKey && get().activeLibraryUserKey === userKey ? get().activeLibraryMediaType : null;
          if (
            activeSession &&
            persistedActiveLibraryId &&
            persistedActiveLibraryName &&
            !activeSession.activeLibraryId
          ) {
            authStorage.updateSession(activeSession.key, {
              activeLibraryId: persistedActiveLibraryId,
              activeLibraryName: persistedActiveLibraryName,
              activeLibraryMediaType: persistedActiveLibraryMediaType,
            });
            activeSession.activeLibraryId = persistedActiveLibraryId;
            activeSession.activeLibraryName = persistedActiveLibraryName;
            activeSession.activeLibraryMediaType = persistedActiveLibraryMediaType;
          }
          const hasMatchingLibrary =
            Boolean(userKey) &&
            (get().activeLibraryUserKey === userKey ||
              Boolean(activeSession?.activeLibraryId && activeSession?.activeLibraryName));
          const hydratedActiveLibraryMediaType =
            activeSession?.activeLibraryMediaType ??
            persistedActiveLibraryMediaType ??
            get().activeLibraryMediaType;

          log("hydrate:computed", {
            hasStoredCredentials,
            hasAccessToken: Boolean(secrets.accessToken),
            hasRefreshToken: Boolean(secrets.refreshToken),
            hasStoredSession,
            hasOfflineContent: offlineContent,
            hasMatchingLibrary,
          });

          set((state) => {
            const hydratedActiveLibraryId = hasMatchingLibrary
              ? (activeSession?.activeLibraryId ?? state.activeLibraryId)
              : null;
            const hydratedActiveLibraryName = hasMatchingLibrary
              ? (activeSession?.activeLibraryName ?? state.activeLibraryName)
              : null;
            const normalizedHydratedMediaType =
              hydratedActiveLibraryMediaType?.trim().toLowerCase() ?? null;
            const preservesReadyActiveLibrary = Boolean(
              !isInitialHydrate &&
                state.activeLibraryReady &&
                state.activeLibraryId === hydratedActiveLibraryId &&
                state.activeLibraryUserKey === userKey &&
                state.activeLibraryMediaType?.trim().toLowerCase() ===
                  normalizedHydratedMediaType,
            );

            return {
              rememberedSessions: authStorage.getSessionsSnapshot().sessions,
              activeSessionKey: activeSession?.key ?? null,
              storedUsername: activeSession?.username ?? null,
              storedUserId: activeSession?.userId ?? null,
              serverUrl: activeSession?.serverUrl ?? null,
              hasStoredCredentials,
              hasOfflineContent: offlineContent,
              accessToken: secrets.accessToken,
              refreshToken: secrets.refreshToken,
              accessTokenExpiresAt,
              serverConnectionStatus: "unknown",
              status: computeEntryStatus(hasStoredSession, offlineContent),
              loginRequired: hasStoredSession ? false : state.loginRequired,
              lastAuthError: hasStoredSession ? null : state.lastAuthError,
              activeLibraryId: hydratedActiveLibraryId,
              activeLibraryName: hydratedActiveLibraryName,
              activeLibraryUserKey: hasMatchingLibrary ? userKey : null,
              activeLibraryMediaType: hasMatchingLibrary
                ? hydratedActiveLibraryMediaType
                : null,
              activeLibraryReady: Boolean(
                hasMatchingLibrary &&
                  (normalizedHydratedMediaType === "book" || preservesReadyActiveLibrary),
              ),
            };
          });

          log("hydrate:done", {
            status: computeEntryStatus(hasStoredSession, offlineContent),
          });

          if (isInitialHydrate) {
            logStartupDuration("auth hydrate complete", hydrateStartedAtMs, {
              status: computeEntryStatus(hasStoredSession, offlineContent),
              hasStoredSession,
              hasMatchingLibrary,
              hasOfflineContent: offlineContent,
            });
          }
          } catch (error) {
            const offlineContent =
              typeof initialOfflineContent === "boolean"
                ? initialOfflineContent
                : get().hasOfflineContent;
            if (__DEV__) {
              console.warn("[auth-store] hydrate failed", { error });
            }
            set({
              rememberedSessions: authStorage.getSessionsSnapshot().sessions,
              activeSessionKey: null,
              storedUsername: null,
              storedUserId: null,
              serverUrl: null,
              hasStoredCredentials: false,
              hasOfflineContent: offlineContent,
              accessToken: null,
              refreshToken: null,
              accessTokenExpiresAt: null,
              serverConnectionStatus: "unknown",
              status: computeEntryStatus(false, offlineContent),
              loginRequired: false,
              lastAuthError: "Sign in needed",
              activeLibraryId: null,
              activeLibraryName: null,
              activeLibraryUserKey: null,
              activeLibraryMediaType: null,
              activeLibraryReady: false,
            });
            if (isInitialHydrate) {
              logStartupDuration("auth hydrate failed", hydrateStartedAtMs, {
                error: error instanceof Error ? error.message : String(error),
                hasOfflineContent: offlineContent,
              });
            }
          }
          };
          hydratePromise = run().finally(() => {
            hydratePromise = null;
          });
          return hydratePromise;
        },

        setOnlineStatus: (isOnline) => {
          set((state) => ({
            isOnline,
            serverConnectionStatus:
              !isOnline || state.isOnline === false ? "unknown" : state.serverConnectionStatus,
          }));
        },

        setServerConnectionStatus: (serverConnectionStatus) => {
          set({ serverConnectionStatus });
        },

        setHasOfflineContent: (hasOfflineContent) => {
          log("setHasOfflineContent:call", { hasOfflineContent });
          set((state) => {
            if (state.status === "hydrating") {
              log("offlineContent:update", {
                hasOfflineContent,
                hasStoredSession: false,
                status: state.status,
              });
              return { hasOfflineContent };
            }
            const hasStoredSession = getHasStoredSession(state);
            log("offlineContent:update", {
              hasOfflineContent,
              hasStoredSession,
            });
            return {
              hasOfflineContent,
              status: computeEntryStatus(hasStoredSession, hasOfflineContent),
            };
          });
        },

        setLoginRequired: (required, message) => {
          log("loginRequired", { required, message });
          set((state) => ({
            loginRequired: required,
            lastAuthError: required ? (message ?? state.lastAuthError) : null,
          }));
        },

        setActiveLibrary: (library) => {
          const trimmedId = library.id.trim();
          const trimmedName = library.name.trim();
          const mediaType = library.mediaType?.trim() || null;
          const userKey = getUserKey(get().storedUserId);
          const activeSessionKey = get().activeSessionKey;
          log("setActiveLibrary", {
            id: trimmedId,
            name: trimmedName,
            mediaType,
            userKey,
            previousId: get().activeLibraryId,
            previousName: get().activeLibraryName,
          });
          if (activeSessionKey) {
            authStorage.updateSession(activeSessionKey, {
              activeLibraryId: trimmedId,
              activeLibraryName: trimmedName,
              activeLibraryMediaType: mediaType,
            });
          }
          set({
            rememberedSessions: authStorage.getSessionsSnapshot().sessions,
            activeLibraryId: trimmedId,
            activeLibraryName: trimmedName,
            activeLibraryUserKey: userKey,
            activeLibraryMediaType: mediaType,
            activeLibraryReady: true,
          });
        },

        clearActiveLibrary: () => {
          set({
            activeLibraryId: null,
            activeLibraryName: null,
            activeLibraryUserKey: null,
            activeLibraryMediaType: null,
            activeLibraryReady: false,
          });
        },

        commitActiveSession: (sessionKey, secrets) => {
          const snapshot = authStorage.getSessionsSnapshot();
          const session = snapshot.sessions.find((item) => item.key === sessionKey);
          if (!session) {
            throw new AuthError("Sign-in entry not found", "INVALID_RESPONSE");
          }

          // The single atomic switch-over: make this session the active one and
          // mirror its identity into in-memory state. The session's remembered Active
          // Library (if any) is committed too, so re-entering a session that already has
          // one stays in serverBrowsing instead of flashing the Library Selection gate;
          // Library Resolution validates it immediately after and corrects it if stale.
          authStorage.setActiveSessionKey(sessionKey);
          const userKey = getUserKey(session.userId);
          set((state) => ({
            rememberedSessions: authStorage.getSessionsSnapshot().sessions,
            activeSessionKey: sessionKey,
            storedUsername: session.username,
            storedUserId: session.userId,
            serverUrl: session.serverUrl,
            accessToken: secrets.accessToken,
            refreshToken: secrets.refreshToken,
            accessTokenExpiresAt: getJwtExpiry(secrets.accessToken),
            serverConnectionStatus: "unknown",
            hasStoredCredentials: secrets.hasPassword,
            status: computeEntryStatus(true, state.hasOfflineContent),
            lastAuthError: null,
            loginRequired: false,
            activeLibraryId: session.activeLibraryId ?? null,
            activeLibraryName: session.activeLibraryName ?? null,
            activeLibraryUserKey: userKey,
            activeLibraryMediaType: session.activeLibraryMediaType ?? null,
            activeLibraryReady: Boolean(
              session.activeLibraryId &&
                session.activeLibraryMediaType?.trim().toLowerCase() === "book",
            ),
          }));
          log("commitActiveSession:done", { sessionKey });
        },

        setSessionNeedsAttention: (sessionKey, message) => {
          authStorage.updateSession(sessionKey, {
            needsAttention: true,
            lastError: message,
          });
          set({
            rememberedSessions: authStorage.getSessionsSnapshot().sessions,
            lastAuthError: message,
          });
        },

        updateRememberedSession: async (sessionKey, values) => {
          const snapshot = authStorage.getSessionsSnapshot();
          const session = snapshot.sessions.find((item) => item.key === sessionKey);
          if (!session) {
            throw new AuthError("Sign-in entry not found", "INVALID_RESPONSE");
          }

          if (values.password !== undefined && values.password !== null) {
            await authStorage.setSessionSecrets(sessionKey, {
              password: values.password,
            });
          }

          authStorage.updateSession(sessionKey, {
            label: values.label?.trim() || getDefaultSessionLabel(session.username, session.serverUrl),
            ...(values.color !== undefined ? { color: values.color } : {}),
            needsAttention: false,
            lastError: null,
          });

          set({
            rememberedSessions: authStorage.getSessionsSnapshot().sessions,
          });
        },

        removeRememberedSession: async (sessionKey) => {
          await authStorage.removeSession(sessionKey);
          set((state) => ({
            rememberedSessions: authStorage.getSessionsSnapshot().sessions,
            activeSessionKey: state.activeSessionKey === sessionKey ? null : state.activeSessionKey,
            storedUsername: state.activeSessionKey === sessionKey ? null : state.storedUsername,
            storedUserId: state.activeSessionKey === sessionKey ? null : state.storedUserId,
            serverUrl: state.activeSessionKey === sessionKey ? null : state.serverUrl,
            accessToken: state.activeSessionKey === sessionKey ? null : state.accessToken,
            refreshToken: state.activeSessionKey === sessionKey ? null : state.refreshToken,
            accessTokenExpiresAt:
              state.activeSessionKey === sessionKey ? null : state.accessTokenExpiresAt,
            hasStoredCredentials:
              state.activeSessionKey === sessionKey ? false : state.hasStoredCredentials,
            activeLibraryId: state.activeSessionKey === sessionKey ? null : state.activeLibraryId,
            activeLibraryName:
              state.activeSessionKey === sessionKey ? null : state.activeLibraryName,
            activeLibraryUserKey:
              state.activeSessionKey === sessionKey ? null : state.activeLibraryUserKey,
            activeLibraryMediaType:
              state.activeSessionKey === sessionKey ? null : state.activeLibraryMediaType,
            activeLibraryReady:
              state.activeSessionKey === sessionKey ? false : state.activeLibraryReady,
            status:
              state.activeSessionKey === sessionKey
                ? computeEntryStatus(false, state.hasOfflineContent)
                : state.status,
          }));
        },

        refreshSession: async (options) => {
          const { force = false } = options ?? {};
          const state = get();
          log("refresh:start", {
            force,
            isOnline: state.isOnline,
            hasAccessToken: Boolean(state.accessToken),
            hasRefreshToken: Boolean(state.refreshToken),
          });

          if (state.isOnline === false) {
            log("refresh:offline");
            throw new AuthError("Offline", "NETWORK_ERROR");
          }

          if (!force && state.accessToken && !isTokenExpired(state.accessTokenExpiresAt)) {
            log("refresh:skip", { reason: "token-valid" });
            return state.accessToken;
          }

          if (refreshPromise) {
            return refreshPromise;
          }

          refreshPromise = (async () => {
            const currentState = get();
            const serverUrl = currentState.serverUrl;
            const activeSessionKey = currentState.activeSessionKey;
            if (!serverUrl) {
              throw new AuthError("Missing server URL", "INVALID_RESPONSE");
            }

            let tokens: { accessToken: string; refreshToken: string } | null = null;

            if (currentState.refreshToken) {
              try {
                log("refresh:attempt");
                tokens = await authService.refresh(serverUrl, currentState.refreshToken);
                log("refresh:success", {
                  hasAccessToken: Boolean(tokens.accessToken),
                  hasRefreshToken: Boolean(tokens.refreshToken),
                });
              } catch (error) {
                if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
                  set({ serverConnectionStatus: "unreachable" });
                  throw error;
                }
                set({ serverConnectionStatus: "reachable" });
                log("refresh:failed");
                tokens = null;
              }
            }

            if (!tokens) {
              const secrets = activeSessionKey
                ? await authStorage.getSessionSecrets(activeSessionKey)
                : { password: null };
              if (currentState.storedUsername && secrets.password) {
                try {
                  log("refresh:fallback-login");
                  const loginResult = await authService.login({
                    username: currentState.storedUsername,
                    password: secrets.password,
                    serverUrl,
                  });
                  if (currentState.storedUserId && loginResult.userId !== currentState.storedUserId) {
                    throw new AuthError("Sign-in returned a different Audiobookshelf user", "INVALID_RESPONSE");
                  }
                  tokens = loginResult;
                  log("refresh:fallback-success");
                } catch (error) {
                  if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
                    set({ serverConnectionStatus: "unreachable" });
                    throw error;
                  }
                  set({ serverConnectionStatus: "reachable" });
                  log("refresh:fallback-failed");
                  tokens = null;
                }
              }
            }

            if (!tokens) {
              if (activeSessionKey) {
                await authStorage.clearSessionTokens(activeSessionKey);
                authStorage.updateSession(activeSessionKey, {
                  needsAttention: true,
                  lastError: "Login required to stream",
                });
              }
              log("refresh:failed-no-tokens");
              set((state) => ({
                rememberedSessions: authStorage.getSessionsSnapshot().sessions,
                accessToken: null,
                refreshToken: null,
                accessTokenExpiresAt: null,
                status: computeEntryStatus(false, state.hasOfflineContent),
                lastAuthError: "Login required to stream",
                loginRequired: true,
                serverConnectionStatus: "reachable",
              }));
              return null;
            }

            if (activeSessionKey) {
              try {
                await authStorage.setSessionSecrets(activeSessionKey, {
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken,
                });
                authStorage.updateSession(activeSessionKey, {
                  needsAttention: false,
                  lastError: null,
                });
              } catch (persistError) {
                // Keychain persist can fail transiently (e.g. locked device on
                // a headless CarPlay launch). The server already rotated the
                // tokens — losing them here would force a re-login. Keep them
                // in memory; the next successful refresh persists again.
                log("refresh:persist-failed", {
                  error:
                    persistError instanceof Error
                      ? persistError.message
                      : String(persistError),
                });
              }
            }

            set((state) => ({
              rememberedSessions: authStorage.getSessionsSnapshot().sessions,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              accessTokenExpiresAt: getJwtExpiry(tokens.accessToken),
              status: computeEntryStatus(true, state.hasOfflineContent),
              lastAuthError: null,
              serverConnectionStatus: "reachable",
            }));

            log("refresh:done", { status: "authenticated" });
            return tokens.accessToken;
          })().finally(() => {
            refreshPromise = null;
            log("refresh:end");
          });

          return refreshPromise;
        },

        logout: async () => {
          log("logout:start");
          const state = get();
          if (state.isOnline && state.serverUrl && state.refreshToken) {
            await authService.logout(state.serverUrl, state.refreshToken);
          }

          if (state.activeSessionKey) {
            const activeSession = state.rememberedSessions.find(
              (session) => session.key === state.activeSessionKey,
            );
            const sessionsToClear = activeSession
              ? state.rememberedSessions.filter((session) => session.userId === activeSession.userId)
              : state.rememberedSessions.filter((session) => session.key === state.activeSessionKey);
            await Promise.all(
              sessionsToClear.map((session) =>
                authStorage.setSessionSecrets(session.key, {
                  password: null,
                  accessToken: null,
                  refreshToken: null,
                }),
              ),
            );
            authStorage.setActiveSessionKey(null);
          }

          set((current) => ({
            rememberedSessions: authStorage.getSessionsSnapshot().sessions,
            activeSessionKey: null,
            storedUsername: null,
            storedUserId: null,
            serverUrl: null,
            accessToken: null,
            refreshToken: null,
            accessTokenExpiresAt: null,
            serverConnectionStatus: "unknown",
            hasStoredCredentials: false,
            activeLibraryId: null,
            activeLibraryName: null,
            activeLibraryUserKey: null,
            activeLibraryMediaType: null,
            activeLibraryReady: false,
            status: computeEntryStatus(false, current.hasOfflineContent),
            lastAuthError: null,
            loginRequired: false,
          }));
          log("logout:done");
        },
      },
    }),
    {
      name: "laabs-auth",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        activeLibraryId: state.activeLibraryId,
        activeLibraryName: state.activeLibraryName,
        activeLibraryUserKey: state.activeLibraryUserKey,
        activeLibraryMediaType: state.activeLibraryMediaType,
        storedUserId: state.storedUserId,
      }),
    },
  ),
);

setAuthErrorHandler((message) => {
  authStore.getState().actions.setLoginRequired(true, message);
});

setAuthProvider({
  getAccessToken: () => authStore.getState().accessToken,
  getAccessTokenExpiresAt: () => authStore.getState().accessTokenExpiresAt,
  getServerUrl: () => authStore.getState().serverUrl,
  getIsOnline: () => authStore.getState().isOnline,
  getIsAnonymous: () => authStore.getState().status === "anonymous",
  refreshSession: (forceRefresh: boolean) =>
    authStore.getState().actions.refreshSession({ force: forceRefresh }),
  setLoginRequired: (required: boolean, message: string) =>
    authStore.getState().actions.setLoginRequired(required, message),
  setServerConnectionStatus: (status: ServerConnectionStatus) =>
    authStore.getState().actions.setServerConnectionStatus(status),
});

export const useAuthStore = <T>(selector: (state: AuthState) => T) => useStore(authStore, selector);

export const useAuthActions = () => useAuthStore((state) => state.actions);

export const getAuthState = () => authStore.getState();

export const selectAccessMode = (state: AuthState): AccessMode => {
  if (state.status === "hydrating") return "hydrating";

  if (state.status === "authenticated") {
    return state.activeLibraryId && state.activeLibraryReady ? "serverBrowsing" : "serverSetup";
  }

  if (state.status === "offlineOnly") {
    return state.loginRequired && Boolean(state.storedUserId && state.serverUrl)
      ? "downloadedSessionOnly"
      : state.hasOfflineContent
        ? "downloadedOnly"
        : "firstRunSignInRequired";
  }

  return "firstRunSignInRequired";
};
