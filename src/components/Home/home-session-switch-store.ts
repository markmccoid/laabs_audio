import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

type HomeSessionSwitchState = {
  pendingSessionKey: string | null;
  previousExperience: "book" | "podcast" | null;
  entryResolved: boolean;
  actions: {
    start: (sessionKey: string, previousExperience: "book" | "podcast" | null) => void;
    resolveEntry: () => void;
    clear: () => void;
  };
};

export const homeSessionSwitchStore = createStore<HomeSessionSwitchState>()((set) => ({
  pendingSessionKey: null,
  previousExperience: null,
  entryResolved: false,
  actions: {
    start: (pendingSessionKey, previousExperience) =>
      set({ pendingSessionKey, previousExperience, entryResolved: false }),
    resolveEntry: () => set({ entryResolved: true }),
    clear: () => set({ pendingSessionKey: null, previousExperience: null, entryResolved: false }),
  },
}));

export const useHomeSessionSwitch = <T,>(selector: (state: HomeSessionSwitchState) => T) =>
  useStore(homeSessionSwitchStore, selector);
