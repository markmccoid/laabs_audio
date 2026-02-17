import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "./mmkv-storage";
import type { PitchCorrectionQuality } from "../player/types";

export type SettingsState = {
  playbackRate: number;
  pitchCorrectionQuality: PitchCorrectionQuality;
  actions: {
    setPlaybackRate: (rate: number) => void;
    setPitchCorrectionQuality: (quality: PitchCorrectionQuality) => void;
  };
};

export const settingsStore = createStore<SettingsState>()(
  persist(
    (set) => ({
      playbackRate: 1,
      pitchCorrectionQuality: "medium",
      actions: {
        setPlaybackRate: (playbackRate) => set({ playbackRate }),
        setPitchCorrectionQuality: (pitchCorrectionQuality) =>
          set({ pitchCorrectionQuality }),
      },
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        playbackRate: state.playbackRate,
        pitchCorrectionQuality: state.pitchCorrectionQuality,
      }),
      version: 1,
    }
  )
);

export const useSettingsStore = <T,>(selector: (state: SettingsState) => T) =>
  useStore(settingsStore, selector);

export const useSettingsActions = () =>
  useSettingsStore((state) => state.actions);
