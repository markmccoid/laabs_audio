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

const getItem = (key: string) => SecureStore.getItemAsync(key);
const setItem = (key: string, value: string) =>
  SecureStore.setItemAsync(key, value);
const deleteItem = (key: string) => SecureStore.deleteItemAsync(key);

export const authStorage = {
  async getCredentials(): Promise<StoredCredentials> {
    const [username, password, serverUrl] = await Promise.all([
      getItem(KEYS.username),
      getItem(KEYS.password),
      getItem(KEYS.serverUrl),
    ]);

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
    await Promise.all([
      setItem(KEYS.username, values.username),
      setItem(KEYS.password, values.password),
      setItem(KEYS.serverUrl, values.serverUrl),
    ]);
  },

  async clearPassword() {
    await deleteItem(KEYS.password);
  },

  async clearCredentials() {
    await Promise.all([
      deleteItem(KEYS.username),
      deleteItem(KEYS.password),
      deleteItem(KEYS.serverUrl),
    ]);
  },

  async getTokens(): Promise<StoredTokens> {
    const [accessToken, refreshToken] = await Promise.all([
      getItem(KEYS.accessToken),
      getItem(KEYS.refreshToken),
    ]);

    return {
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
    };
  },

  async setTokens(values: { accessToken: string; refreshToken: string }) {
    await Promise.all([
      setItem(KEYS.accessToken, values.accessToken),
      setItem(KEYS.refreshToken, values.refreshToken),
    ]);
  },

  async clearTokens() {
    await Promise.all([
      deleteItem(KEYS.accessToken),
      deleteItem(KEYS.refreshToken),
    ]);
  },
};
