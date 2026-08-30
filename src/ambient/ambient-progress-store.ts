import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/**
 * Live mirror of the ambient player's own position, republished on every
 * AMBIENT_PROGRESS tick (~1/second) by `ambient-service.ts`.
 *
 * Deliberately NOT persisted. This is a display channel: routing a 1Hz value
 * through the MMKV-backed ambient store would rewrite the whole persisted slice
 * every second. Durable resume state stays in `store-ambient.ts`, which is
 * written on pause/stop, on a user seek, and every 15s while playing.
 */
export type AmbientProgressStoreState = {
  /** Track the published position belongs to; null when no session is loaded. */
  trackId: string | null;
  /** Book the published position belongs to; null when no session is loaded. */
  libraryItemId: string | null;
  /** Position inside the looping file, in ms. */
  positionMs: number;
  /** Loop length in ms; 0 while the native item has not reported one yet. */
  durationMs: number;
  actions: {
    publish: (progress: {
      trackId: string;
      libraryItemId: string;
      positionMs: number;
      durationMs: number;
    }) => void;
    clear: () => void;
  };
};

const getBaseProgressState = () => ({
  trackId: null,
  libraryItemId: null,
  positionMs: 0,
  durationMs: 0,
});

export const ambientProgressStore = createStore<AmbientProgressStoreState>()((set) => ({
  ...getBaseProgressState(),
  actions: {
    publish: ({ trackId, libraryItemId, positionMs, durationMs }) =>
      set((state) => {
        // Ticks repeat the same values whenever the player is paused or has
        // gone quiet; skipping same-value writes keeps those from rerendering
        // every subscriber once a second for nothing.
        if (
          state.trackId === trackId &&
          state.libraryItemId === libraryItemId &&
          state.positionMs === positionMs &&
          state.durationMs === durationMs
        ) {
          return state;
        }

        return { trackId, libraryItemId, positionMs, durationMs };
      }),
    clear: () =>
      set((state) => {
        if (state.trackId === null && state.libraryItemId === null && state.positionMs === 0) {
          return state;
        }

        return getBaseProgressState();
      }),
  },
}));

export const useAmbientProgressStore = <T,>(selector: (state: AmbientProgressStoreState) => T) =>
  useStore(ambientProgressStore, selector);
