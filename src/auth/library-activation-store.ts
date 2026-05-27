import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Library } from "../types/absTypes";

export type LibraryActivationStatus = "idle" | "activating" | "failed";

type LibraryActivationState = {
  status: LibraryActivationStatus;
  library: Library | null;
  errorMessage: string | null;
  actions: {
    start: (library: Library) => void;
    fail: (error: unknown) => void;
    clear: () => void;
  };
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message
    : "Could not load this library.";

export const libraryActivationStore = createStore<LibraryActivationState>()((set) => ({
  status: "idle",
  library: null,
  errorMessage: null,
  actions: {
    start: (library) => {
      set({
        status: "activating",
        library,
        errorMessage: null,
      });
    },
    fail: (error) => {
      set((state) => ({
        status: "failed",
        library: state.library,
        errorMessage: toErrorMessage(error),
      }));
    },
    clear: () => {
      set({
        status: "idle",
        library: null,
        errorMessage: null,
      });
    },
  },
}));

export function useLibraryActivationStore<T>(selector: (state: LibraryActivationState) => T) {
  return useStore(libraryActivationStore, selector);
}

export const useLibraryActivationActions = () =>
  useLibraryActivationStore((state) => state.actions);
