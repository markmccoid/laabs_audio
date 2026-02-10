import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { authStorage } from "./auth-storage";
import { AuthError, authService } from "./auth-service";
import { getJwtExpiry, isTokenExpired } from "./auth-token";

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
  actions: {
    hydrateFromStorage: (initialOfflineContent?: boolean) => Promise<void>;
    setOnlineStatus: (isOnline: boolean) => void;
    setHasOfflineContent: (hasOfflineContent: boolean) => void;
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

let refreshPromise: Promise<string | null> | null = null;

export const authStore = createStore<AuthState>((set, get) => ({
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
  actions: {
    hydrateFromStorage: async (initialOfflineContent) => {
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

      set((state) => ({
        storedUsername: credentials.username,
        serverUrl: credentials.serverUrl,
        hasStoredCredentials,
        hasOfflineContent: offlineContent,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt,
        status: computeEntryStatus(hasStoredSession, offlineContent),
      }));
    },

    setOnlineStatus: (isOnline) => {
      set({ isOnline });
    },

    setHasOfflineContent: (hasOfflineContent) => {
      set((state) => {
        const hasStoredSession = getHasStoredSession(state);
        return {
          hasOfflineContent,
          status: computeEntryStatus(hasStoredSession, hasOfflineContent),
        };
      });
    },

    loginWithPassword: async (username, password, serverUrl) => {
      const normalizedServerUrl = authService.normalizeServerUrl(serverUrl);
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

      set((state) => ({
        storedUsername: username,
        serverUrl: normalizedServerUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: getJwtExpiry(tokens.accessToken),
        hasStoredCredentials: true,
        status: computeEntryStatus(true, state.hasOfflineContent),
        lastAuthError: null,
      }));
    },

    refreshSession: async (options) => {
      const { force = false } = options ?? {};
      const state = get();

      if (state.isOnline === false) {
        throw new AuthError("Offline", "NETWORK_ERROR");
      }

      if (!force && state.accessToken && !isTokenExpired(state.accessTokenExpiresAt)) {
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
            tokens = await authService.refresh(
              serverUrl,
              currentState.refreshToken
            );
          } catch (_error) {
            tokens = null;
          }
        }

        if (!tokens) {
          const credentials = await authStorage.getCredentials();
          if (getHasStoredCredentials(credentials)) {
            tokens = await authService.login({
              username: credentials.username as string,
              password: credentials.password as string,
              serverUrl: credentials.serverUrl as string,
            });
          }
        }

        if (!tokens) {
          set({ lastAuthError: "Unable to refresh session" });
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

        return tokens.accessToken;
      })().finally(() => {
        refreshPromise = null;
      });

      return refreshPromise;
    },

    logout: async () => {
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
        status: computeEntryStatus(false, current.hasOfflineContent),
        lastAuthError: null,
      }));
    },
  },
}));

export const useAuthStore = <T,>(selector: (state: AuthState) => T) =>
  useStore(authStore, selector);

export const useAuthActions = () => useAuthStore((state) => state.actions);

export const getAuthState = () => authStore.getState();
