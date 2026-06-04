import * as SecureStore from "expo-secure-store";
import { mmkvStorage } from "../store/mmkv-storage";
import { logStartupDuration, markStartup } from "../utils/dev-startup-tracing";

export type StoredCredentials = {
  username: string | null;
  password: string | null;
  serverUrl: string | null;
};

export type StoredTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

export type RememberedSessionRecord = {
  key: string;
  userId: string;
  username: string;
  serverUrl: string;
  label: string;
  activeLibraryId: string | null;
  activeLibraryName: string | null;
  needsAttention: boolean;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SessionSecrets = {
  password: string | null;
  accessToken: string | null;
  refreshToken: string | null;
};

export type AuthSessionsSnapshot = {
  sessions: RememberedSessionRecord[];
  activeSessionKey: string | null;
  migrationVersion: number;
};

const KEYS = {
  username: "abs.username",
  password: "abs.password",
  serverUrl: "abs.serverUrl",
  accessToken: "abs.accessToken",
  refreshToken: "abs.refreshToken",
  sessions: "abs.sessions",
};

const log = (...args: unknown[]) => {
  if (__DEV__) {
  }
};

const secureStoreAvailablePromise = SecureStore.isAvailableAsync().catch(
  () => false,
);

const logAvailability = async () => {
  const available = await secureStoreAvailablePromise;
  log("available", available);
  return available;
};

const getItem = (key: string) => SecureStore.getItemAsync(key);
const setItem = (key: string, value: string) =>
  SecureStore.setItemAsync(key, value);
const deleteItem = (key: string) => SecureStore.deleteItemAsync(key);

const DEFAULT_SESSION_SNAPSHOT: AuthSessionsSnapshot = {
  sessions: [],
  activeSessionKey: null,
  migrationVersion: 0,
};

const encodeSessionKeyPart = (value: string) =>
  encodeURIComponent(value).replace(/%/g, "_").replace(/~/g, "_7E");

export const getSessionKey = (username: string, serverUrl: string) =>
  `v2.${encodeSessionKeyPart(serverUrl)}.${encodeSessionKeyPart(username)}`;

export const getDefaultSessionLabel = (username: string, serverUrl: string) =>
  `${username} @ ${serverUrl}`;

const getSecretKey = (
  sessionKey: string,
  kind: "password" | "accessToken" | "refreshToken",
) => `abs.session.${sessionKey}.${kind}`;

const normalizeSnapshot = (value: unknown): AuthSessionsSnapshot => {
  if (!value || typeof value !== "object") return DEFAULT_SESSION_SNAPSHOT;

  const record = value as Partial<AuthSessionsSnapshot>;
  const rawSessions = Array.isArray(record.sessions)
    ? record.sessions.filter((session): session is RememberedSessionRecord => {
        if (!session || typeof session !== "object") return false;
        const candidate = session as Partial<RememberedSessionRecord>;
        return (
          typeof candidate.key === "string" &&
          typeof candidate.userId === "string" &&
          typeof candidate.username === "string" &&
          typeof candidate.serverUrl === "string" &&
          typeof candidate.label === "string"
        );
      })
    : [];
  const activeRawSession =
    typeof record.activeSessionKey === "string"
      ? rawSessions.find((session) => session.key === record.activeSessionKey)
      : undefined;
  const sessionsByKey = new Map<string, RememberedSessionRecord>();

  rawSessions.forEach((session) => {
    const safeKey = getSessionKey(session.username, session.serverUrl);
    const normalizedSession: RememberedSessionRecord = {
      key: safeKey,
      userId: session.userId,
      username: session.username,
      serverUrl: session.serverUrl,
      label: session.label || getDefaultSessionLabel(session.username, session.serverUrl),
      activeLibraryId: session.activeLibraryId ?? null,
      activeLibraryName: session.activeLibraryName ?? null,
      needsAttention: Boolean(session.needsAttention),
      lastError: session.lastError ?? null,
      createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
      updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : Date.now(),
    };
    const existing = sessionsByKey.get(safeKey);
    sessionsByKey.set(safeKey, existing ? { ...normalizedSession, createdAt: existing.createdAt } : normalizedSession);
  });

  const sessions = Array.from(sessionsByKey.values());
  const safeActiveSessionKey = activeRawSession
    ? getSessionKey(activeRawSession.username, activeRawSession.serverUrl)
    : typeof record.activeSessionKey === "string"
      ? record.activeSessionKey
      : null;
  const activeSessionKey =
    typeof safeActiveSessionKey === "string" &&
    sessions.some((session) => session.key === safeActiveSessionKey)
      ? safeActiveSessionKey
      : null;

  return {
    sessions,
    activeSessionKey,
    migrationVersion: typeof record.migrationVersion === "number" ? record.migrationVersion : 0,
  };
};

const readSessionSnapshot = (): AuthSessionsSnapshot => {
  const rawValue = mmkvStorage.getItem(KEYS.sessions) as string | null;
  if (!rawValue) return DEFAULT_SESSION_SNAPSHOT;

  try {
    return normalizeSnapshot(JSON.parse(rawValue));
  } catch {
    return DEFAULT_SESSION_SNAPSHOT;
  }
};

const writeSessionSnapshot = (snapshot: AuthSessionsSnapshot) => {
  mmkvStorage.setItem(KEYS.sessions, JSON.stringify(normalizeSnapshot(snapshot)));
};

const upsertSessionInSnapshot = (
  snapshot: AuthSessionsSnapshot,
  session: RememberedSessionRecord,
) => {
  const existingIndex = snapshot.sessions.findIndex((item) => item.key === session.key);
  const sessions =
    existingIndex === -1
      ? [...snapshot.sessions, session]
      : snapshot.sessions.map((item, index) => (index === existingIndex ? session : item));

  return {
    ...snapshot,
    sessions,
  };
};

export const authStorage = {
  getSessionsSnapshot(): AuthSessionsSnapshot {
    return readSessionSnapshot();
  },

  setActiveSessionKey(sessionKey: string | null) {
    const snapshot = readSessionSnapshot();
    writeSessionSnapshot({
      ...snapshot,
      activeSessionKey: sessionKey,
    });
  },

  upsertSession(
    values: {
      username: string;
      serverUrl: string;
      userId: string;
      label?: string | null;
      activeLibraryId?: string | null;
      activeLibraryName?: string | null;
      needsAttention?: boolean;
      lastError?: string | null;
    },
    options?: { makeActive?: boolean },
  ) {
    const key = getSessionKey(values.username, values.serverUrl);
    const snapshot = readSessionSnapshot();
    const now = Date.now();
    const existing = snapshot.sessions.find((session) => session.key === key);
    const session: RememberedSessionRecord = {
      key,
      userId: values.userId,
      username: values.username,
      serverUrl: values.serverUrl,
      label:
        values.label?.trim() ||
        existing?.label ||
        getDefaultSessionLabel(values.username, values.serverUrl),
      activeLibraryId: values.activeLibraryId ?? existing?.activeLibraryId ?? null,
      activeLibraryName: values.activeLibraryName ?? existing?.activeLibraryName ?? null,
      needsAttention: values.needsAttention ?? existing?.needsAttention ?? false,
      lastError: values.lastError ?? existing?.lastError ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nextSnapshot = upsertSessionInSnapshot(snapshot, session);
    writeSessionSnapshot({
      ...nextSnapshot,
      activeSessionKey: options?.makeActive ? key : nextSnapshot.activeSessionKey,
    });

    return session;
  },

  updateSession(sessionKey: string, patch: Partial<RememberedSessionRecord>) {
    const snapshot = readSessionSnapshot();
    const nextSessions = snapshot.sessions.map((session) =>
      session.key === sessionKey
        ? {
            ...session,
            ...patch,
            key: session.key,
            userId: session.userId,
            username: session.username,
            serverUrl: session.serverUrl,
            label: patch.label?.trim() || session.label,
            updatedAt: Date.now(),
          }
        : session,
    );
    writeSessionSnapshot({ ...snapshot, sessions: nextSessions });
  },

  async getSessionSecrets(sessionKey: string): Promise<SessionSecrets> {
    await logAvailability();
    const [password, accessToken, refreshToken] = await Promise.all([
      getItem(getSecretKey(sessionKey, "password")),
      getItem(getSecretKey(sessionKey, "accessToken")),
      getItem(getSecretKey(sessionKey, "refreshToken")),
    ]);

    return {
      password: password ?? null,
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
    };
  },

  async setSessionSecrets(
    sessionKey: string,
    values: {
      password?: string | null;
      accessToken?: string | null;
      refreshToken?: string | null;
    },
  ) {
    await logAvailability();
    const writes: Promise<void>[] = [];
    if (values.password !== undefined) {
      writes.push(
        values.password ? setItem(getSecretKey(sessionKey, "password"), values.password) : deleteItem(getSecretKey(sessionKey, "password")),
      );
    }
    if (values.accessToken !== undefined) {
      writes.push(
        values.accessToken
          ? setItem(getSecretKey(sessionKey, "accessToken"), values.accessToken)
          : deleteItem(getSecretKey(sessionKey, "accessToken")),
      );
    }
    if (values.refreshToken !== undefined) {
      writes.push(
        values.refreshToken
          ? setItem(getSecretKey(sessionKey, "refreshToken"), values.refreshToken)
          : deleteItem(getSecretKey(sessionKey, "refreshToken")),
      );
    }
    await Promise.all(writes);
  },

  async clearSessionTokens(sessionKey: string) {
    await this.setSessionSecrets(sessionKey, {
      accessToken: null,
      refreshToken: null,
    });
  },

  async removeSession(sessionKey: string) {
    const snapshot = readSessionSnapshot();
    writeSessionSnapshot({
      ...snapshot,
      sessions: snapshot.sessions.filter((session) => session.key !== sessionKey),
      activeSessionKey: snapshot.activeSessionKey === sessionKey ? null : snapshot.activeSessionKey,
    });
    await this.setSessionSecrets(sessionKey, {
      password: null,
      accessToken: null,
      refreshToken: null,
    });
  },

  async migrateLegacySessionIfNeeded() {
    const snapshot = readSessionSnapshot();
    if (snapshot.migrationVersion >= 2) return snapshot;

    const oldSessions = snapshot.sessions;
    await Promise.all(
      oldSessions.map((session) =>
        this.setSessionSecrets(session.key, {
          password: null,
          accessToken: null,
          refreshToken: null,
        }),
      ),
    );
    const migratedSnapshot: AuthSessionsSnapshot = {
      sessions: [],
      activeSessionKey: null,
      migrationVersion: 2,
    };
    writeSessionSnapshot(migratedSnapshot);
    await this.clearLegacySession();
    return migratedSnapshot;
  },

  async clearLegacySession() {
    await logAvailability();
    await Promise.all([
      deleteItem(KEYS.username),
      deleteItem(KEYS.password),
      deleteItem(KEYS.serverUrl),
      deleteItem(KEYS.accessToken),
      deleteItem(KEYS.refreshToken),
    ]);
  },

  async getCredentials(): Promise<StoredCredentials> {
    const startedAtMs = markStartup("secure-store-credentials-start");
    await logAvailability();
    const [username, password, serverUrl] = await Promise.all([
      getItem(KEYS.username),
      getItem(KEYS.password),
      getItem(KEYS.serverUrl),
    ]);

    log("getCredentials", {
      hasUsername: Boolean(username),
      hasPassword: Boolean(password),
      hasServerUrl: Boolean(serverUrl),
    });
    logStartupDuration("secure-store credentials read", startedAtMs, {
      hasUsername: Boolean(username),
      hasPassword: Boolean(password),
      hasServerUrl: Boolean(serverUrl),
    });

    return {
      username: username ?? null,
      password: password ?? null,
      serverUrl: serverUrl ?? null,
    };
  },

  async setCredentials(values: {
    username: string;
    password: string;
    serverUrl: string;
  }) {
    await logAvailability();
    log("setCredentials", {
      username: values.username,
      hasPassword: Boolean(values.password),
      serverUrl: values.serverUrl,
    });
    await Promise.all([
      setItem(KEYS.username, values.username),
      setItem(KEYS.password, values.password),
      setItem(KEYS.serverUrl, values.serverUrl),
    ]);
    log("setCredentials:done");
  },

  async clearPassword() {
    await logAvailability();
    log("clearPassword");
    await deleteItem(KEYS.password);
  },

  async clearUsernameAndPassword() {
    await logAvailability();
    log("clearUsernameAndPassword");
    await Promise.all([
      deleteItem(KEYS.username),
      deleteItem(KEYS.password),
    ]);
  },

  async clearCredentials() {
    await logAvailability();
    log("clearCredentials");
    await Promise.all([
      deleteItem(KEYS.username),
      deleteItem(KEYS.password),
      deleteItem(KEYS.serverUrl),
    ]);
  },

  async getTokens(): Promise<StoredTokens> {
    const startedAtMs = markStartup("secure-store-tokens-start");
    await logAvailability();
    const [accessToken, refreshToken] = await Promise.all([
      getItem(KEYS.accessToken),
      getItem(KEYS.refreshToken),
    ]);

    log("getTokens", {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
    });
    logStartupDuration("secure-store tokens read", startedAtMs, {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
    });

    return {
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
    };
  },

  async setTokens(values: { accessToken: string; refreshToken: string }) {
    await logAvailability();
    log("setTokens", {
      hasAccessToken: Boolean(values.accessToken),
      hasRefreshToken: Boolean(values.refreshToken),
    });
    await Promise.all([
      setItem(KEYS.accessToken, values.accessToken),
      setItem(KEYS.refreshToken, values.refreshToken),
    ]);
    log("setTokens:done");
  },

  async clearTokens() {
    await logAvailability();
    log("clearTokens");
    await Promise.all([
      deleteItem(KEYS.accessToken),
      deleteItem(KEYS.refreshToken),
    ]);
  },
};
