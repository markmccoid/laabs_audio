import * as SecureStore from "expo-secure-store";

export type StoredCredentials = {
  username: string | null;
  password: string | null;
  serverUrl: string | null;
};

export type StoredTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

const KEYS = {
  username: "abs.username",
  password: "abs.password",
  serverUrl: "abs.serverUrl",
  accessToken: "abs.accessToken",
  refreshToken: "abs.refreshToken",
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

export const authStorage = {
  async getCredentials(): Promise<StoredCredentials> {
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
    await logAvailability();
    const [accessToken, refreshToken] = await Promise.all([
      getItem(KEYS.accessToken),
      getItem(KEYS.refreshToken),
    ]);

    log("getTokens", {
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
