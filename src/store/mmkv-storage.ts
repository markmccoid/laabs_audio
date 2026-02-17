import { createMMKV } from "react-native-mmkv";
import type { StateStorage } from "zustand/middleware";

const storage = createMMKV({ id: "laabs-mmkv" });

export const mmkvStorage: StateStorage = {
  getItem: (name) => {
    const value = storage.getString(name);
    return value ?? null;
  },
  setItem: (name, value) => {
    storage.set(name, value);
  },
  removeItem: (name) => {
    return storage.remove(name);
  },
};
