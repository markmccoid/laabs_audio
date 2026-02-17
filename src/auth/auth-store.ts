import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { authStorage } from "./auth-storage";
import { AuthError, authService } from "./auth-service";
import { getJwtExpiry, isTokenExpired } from "./auth-token";
import { mmkvStorage } from "../store/mmkv-storage";

const log = (...args: unknown[]) => {
  if (__DEV__) {
  }
};

export type AuthStatus =
  | "hydrating"
  | "anonymous"
  | "authenticated"
  | "offlineOnly";

export type AuthState = {
  status: AuthStatus;
  hasStoredCredentials: boolean;
  hasOfflineContent: boolean;
  isOnline: boolean | null;
  storedUsername: string | null;
  serverUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
  lastAuthError: string | null;
  loginRequired: boolean;
  activeLibraryId: string | null;
  activeLibraryName: string | null;
  activeLibraryUserKey: string | null;
  actions: {
    hydrateFromStorage: (initialOfflineContent?: boolean) => Promise<void>;
    setOnlineStatus: (isOnline: boolean) => void;
    setHasOfflineContent: (hasOfflineContent: boolean) => void;
    setLoginRequired: (required: boolean, message?: string | null) => void;
    setActiveLibrary: (library: { id: string; name: string }) => void;
    clearActiveLibrary: () => void;
    loginWithPassword: (
      username: string,
      password: string,
      serverUrl: string
    ) => Promise<void>;
    refreshSession: (options?: { force?: boolean }) => Promise<string | null>;
    logout: () => Promise<void>;
  };
};

const computeEntryStatus = (
  hasSession: boolean,
  hasOfflineContent: boolean
): AuthStatus => {
  if (hasSession) return "authenticated";
  if (hasOfflineContent) return "offlineOnly";
  return "anonymous";
};

const getHasStoredCredentials = (values: {
  username: string | null;
  password: string | null;
  serverUrl: string | null;
}) => Boolean(values.username && values.password && values.serverUrl);

const getHasStoredSession = (state: {
  hasStoredCredentials: boolean;
  accessToken: string | null;
  refreshToken: string | null;
}) => Boolean(state.hasStoredCredentials || state.refreshToken || state.accessToken);

const getUserKey = (username: string | null, serverUrl: string | null) => {
  if (!username || !serverUrl) return null;
  return `${username}::${serverUrl}`;
};

let refreshPromise: Promise<string | null> | null = null;

export const authStore = createStore<AuthState>()(
  persist(
    (set, get) => ({
  status: "hydrating",
  hasStoredCredentials: false,
  hasOfflineContent: false,
  isOnline: null,
  storedUsername: null,
  serverUrl: null,
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  lastAuthError: null,
  loginRequired: false,
  activeLibraryId: null,
  activeLibraryName: null,
  activeLibraryUserKey: null,
  actions: {
    hydrateFromStorage: async (initialOfflineContent) => {
      log("hydrate:start");
      const [credentials, tokens] = await Promise.all([
        authStorage.getCredentials(),
        authStorage.getTokens(),
      ]);

      const hasStoredCredentials = getHasStoredCredentials(credentials);
      const accessTokenExpiresAt = getJwtExpiry(tokens.accessToken);
      const offlineContent =
        typeof initialOfflineContent === "boolean"
          ? initialOfflineContent
          : get().hasOfflineContent;
      const hasStoredSession = getHasStoredSession({
        hasStoredCredentials,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      const userKey = getUserKey(credentials.username, credentials.serverUrl);
      const hasMatchingLibrary =
        Boolean(userKey) && get().activeLibraryUserKey === userKey;

      log("hydrate:computed", {
        hasStoredCredentials,
        hasAccessToken: Boolean(tokens.accessToken),
        hasRefreshToken: Boolean(tokens.refreshToken),
        hasStoredSession,
        hasOfflineContent: offlineContent,
        hasMatchingLibrary,
      });

      set((state) => ({
        storedUsername: credentials.username,
        serverUrl: credentials.serverUrl,
        hasStoredCredentials,
        hasOfflineContent: offlineContent,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt,
        status: computeEntryStatus(hasStoredSession, offlineContent),
        loginRequired: hasStoredSession ? false : state.loginRequired,
        lastAuthError: hasStoredSession ? null : state.lastAuthError,
        activeLibraryId: hasMatchingLibrary ? state.activeLibraryId : null,
        activeLibraryName: hasMatchingLibrary ? state.activeLibraryName : null,
        activeLibraryUserKey: hasMatchingLibrary ? state.activeLibraryUserKey : userKey,
      }));

      log("hydrate:done", {
        status: computeEntryStatus(hasStoredSession, offlineContent),
      });
    },

    setOnlineStatus: (isOnline) => {
      set({ isOnline });
    },

    setHasOfflineContent: (hasOfflineContent) => {
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
        lastAuthError: required ? message ?? state.lastAuthError : null,
      }));
    },

    setActiveLibrary: (library) => {
      const trimmedId = library.id.trim();
      const trimmedName = library.name.trim();
      const userKey = getUserKey(get().storedUsername, get().serverUrl);
      set({
        activeLibraryId: trimmedId,
        activeLibraryName: trimmedName,
        activeLibraryUserKey: userKey,
      });
    },

    clearActiveLibrary: () => {
      set({
        activeLibraryId: null,
        activeLibraryName: null,
        activeLibraryUserKey: null,
      });
    },

    loginWithPassword: async (username, password, serverUrl) => {
      log("login:start", { username, serverUrl });
      const normalizedServerUrl = authService.normalizeServerUrl(serverUrl);
      const previousUserKey = getUserKey(get().storedUsername, get().serverUrl);
      const nextUserKey = getUserKey(username, normalizedServerUrl);
      const isSameUser = previousUserKey === nextUserKey;
      const tokens = await authService.login({
        username,
        password,
        serverUrl: normalizedServerUrl,
      });

      await Promise.all([
        authStorage.setCredentials({
          username,
          password,
          serverUrl: normalizedServerUrl,
        }),
        authStorage.setTokens(tokens),
      ]);

      log("login:stored", {
        hasAccessToken: Boolean(tokens.accessToken),
        hasRefreshToken: Boolean(tokens.refreshToken),
      });

      set((state) => ({
        storedUsername: username,
        serverUrl: normalizedServerUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: getJwtExpiry(tokens.accessToken),
        hasStoredCredentials: true,
        status: computeEntryStatus(true, state.hasOfflineContent),
        lastAuthError: null,
        loginRequired: false,
        activeLibraryId: isSameUser ? state.activeLibraryId : null,
        activeLibraryName: isSameUser ? state.activeLibraryName : null,
        activeLibraryUserKey: isSameUser ? state.activeLibraryUserKey : nextUserKey,
      }));

      log("login:done", { status: "authenticated" });
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
        if (!serverUrl) {
          throw new AuthError("Missing server URL", "INVALID_RESPONSE");
        }

        let tokens: { accessToken: string; refreshToken: string } | null = null;

        if (currentState.refreshToken) {
          try {
            log("refresh:attempt");
            tokens = await authService.refresh(
              serverUrl,
              currentState.refreshToken
            );
            log("refresh:success", {
              hasAccessToken: Boolean(tokens.accessToken),
              hasRefreshToken: Boolean(tokens.refreshToken),
            });
          } catch (error) {
            if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
              throw error;
            }
            log("refresh:failed");
            tokens = null;
          }
        }

        if (!tokens) {
          const credentials = await authStorage.getCredentials();
          if (getHasStoredCredentials(credentials)) {
            try {
              log("refresh:fallback-login");
              tokens = await authService.login({
                username: credentials.username as string,
                password: credentials.password as string,
                serverUrl: credentials.serverUrl as string,
              });
              log("refresh:fallback-success");
            } catch (error) {
              if (error instanceof AuthError && error.code === "NETWORK_ERROR") {
                throw error;
              }
              log("refresh:fallback-failed");
              tokens = null;
            }
          }
        }

        if (!tokens) {
          await authStorage.clearTokens();
          log("refresh:failed-no-tokens");
          set((state) => ({
            accessToken: null,
            refreshToken: null,
            accessTokenExpiresAt: null,
            status: computeEntryStatus(false, state.hasOfflineContent),
            lastAuthError: "Login required to stream",
            loginRequired: true,
          }));
          return null;
        }

        await authStorage.setTokens(tokens);

        set((state) => ({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresAt: getJwtExpiry(tokens.accessToken),
          status: computeEntryStatus(true, state.hasOfflineContent),
          lastAuthError: null,
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

      await Promise.all([
        authStorage.clearTokens(),
        authStorage.clearPassword(),
      ]);

      set((current) => ({
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
        hasStoredCredentials: false,
        activeLibraryId: null,
        activeLibraryName: null,
        activeLibraryUserKey: null,
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
      }),
    },
  ),
);

export const useAuthStore = <T,>(selector: (state: AuthState) => T) =>
  useStore(authStore, selector);

export const useAuthActions = () => useAuthStore((state) => state.actions);

export const getAuthState = () => authStore.getState();
