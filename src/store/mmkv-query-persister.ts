import { createMMKV } from "react-native-mmkv";
import type { PersistedClient, Persister } from "@tanstack/query-persist-client-core";

// Dedicated MMKV instance for React Query persistence (kept separate from Zustand)
const storage = createMMKV({ id: "laabs-mmkv-query" });
const STORAGE_KEY = "react-query-cache";

export const mmkvQueryPersister: Persister = {
  // Save the entire persisted client snapshot
  persistClient: (client) => {
    storage.set(STORAGE_KEY, JSON.stringify(client));
  },
  // Restore the client snapshot on app start
  restoreClient: () => {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as PersistedClient;
    } catch {
      return undefined;
    }
  },
  // Clear persisted data (e.g., on logout or user switch)
  removeClient: () => {
    storage.remove(STORAGE_KEY);
  },
};
