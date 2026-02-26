import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "../store/mmkv-storage";
import { playbackStore } from "./playback-store";
import type { ResolvedChapter } from "./types";

export const MIN_SLEEP_TIMER_MINUTES = 1;
export const MAX_SLEEP_TIMER_MINUTES = 360;
export const DEFAULT_SLEEP_TIMER_MINUTES = 10;
export const DEFAULT_CUSTOM_SLEEP_TIMER_PRESETS = [5, 10, 15, 20, 30, 45];

export type SleepTimerMode = "minutes" | "end_of_chapter" | "end_of_next_chapter";

export type SleepTimerSession = {
  mode: SleepTimerMode;
  libraryItemId: string | null;
  startedAtMs: number;
  endsAtMs: number | null;
  chapterTarget: {
    chapterId: ResolvedChapter["id"];
    chapterTitle: string;
    chapterIndex: number;
    chapterStartMs: number;
    chapterEndMs: number;
  } | null;
};

type SleepTimerStoreState = {
  draftMinutes: number;
  customMinutePresets: number[];
  activeTimer: SleepTimerSession | null;
  actions: {
    setDraftMinutes: (minutes: number) => void;
    adjustMinutesBy: (deltaMinutes: number) => void;
    startMinutesTimer: (minutes?: number) => void;
    startChapterTimer: (mode: Extract<SleepTimerMode, "end_of_chapter" | "end_of_next_chapter">) => void;
    stopTimer: () => void;
    addCustomPreset: (minutes: number) => void;
    removeCustomPreset: (minutes: number) => void;
  };
};

const clampTimerMinutes = (value: number) =>
  Math.max(MIN_SLEEP_TIMER_MINUTES, Math.min(MAX_SLEEP_TIMER_MINUTES, Math.round(value)));

const normalizePresetMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes)) return null;
  return clampTimerMinutes(minutes);
};

const normalizePresetList = (values: number[]) => {
  const deduped = new Set<number>();
  values.forEach((minutes) => {
    const normalized = normalizePresetMinutes(minutes);
    if (normalized === null) return;
    deduped.add(normalized);
  });
  return Array.from(deduped).sort((a, b) => a - b);
};

const formatClock = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const createMinutesTimer = (minutes: number): SleepTimerSession => {
  const resolvedMinutes = clampTimerMinutes(minutes);
  const startedAtMs = Date.now();
  return {
    mode: "minutes",
    libraryItemId: playbackStore.getState().libraryItemId,
    startedAtMs,
    endsAtMs: startedAtMs + resolvedMinutes * 60_000,
    chapterTarget: null,
  };
};

const findCurrentChapterIndex = (
  chapters: ResolvedChapter[],
  currentChapterId: ResolvedChapter["id"] | null,
  positionMs: number,
) => {
  if (!chapters.length) return -1;

  if (currentChapterId != null) {
    const byCurrentId = chapters.findIndex((chapter) => chapter.id === currentChapterId);
    if (byCurrentId >= 0) return byCurrentId;
  }

  const byPosition = chapters.findIndex(
    (chapter) => positionMs >= chapter.startMs && positionMs < chapter.endMs,
  );
  if (byPosition >= 0) return byPosition;

  if (positionMs < chapters[0].startMs) return 0;
  if (positionMs >= chapters[chapters.length - 1].endMs) return chapters.length - 1;
  return -1;
};

const resolveChapterTarget = (
  mode: Extract<SleepTimerMode, "end_of_chapter" | "end_of_next_chapter">,
) => {
  const playbackState = playbackStore.getState();
  const chapters = playbackState.chapterIndex;
  if (!chapters.length) return null;

  const currentIndex = findCurrentChapterIndex(
    chapters,
    playbackState.currentChapterId,
    playbackState.positionMs,
  );
  if (currentIndex < 0) return null;

  const targetIndex =
    mode === "end_of_next_chapter"
      ? Math.min(currentIndex + 1, chapters.length - 1)
      : currentIndex;
  const targetChapter = chapters[targetIndex];
  if (!targetChapter) return null;

  return {
    chapterId: targetChapter.id,
    chapterTitle: targetChapter.title,
    chapterIndex: targetIndex,
    chapterStartMs: targetChapter.startMs,
    chapterEndMs: targetChapter.endMs,
  };
};

const normalizeActiveTimer = (activeTimer: unknown): SleepTimerSession | null => {
  if (!activeTimer || typeof activeTimer !== "object") return null;
  const timer = activeTimer as Partial<SleepTimerSession>;
  if (timer.mode === "minutes") {
    return {
      mode: "minutes",
      libraryItemId: typeof timer.libraryItemId === "string" ? timer.libraryItemId : null,
      startedAtMs: typeof timer.startedAtMs === "number" ? timer.startedAtMs : Date.now(),
      endsAtMs: typeof timer.endsAtMs === "number" ? timer.endsAtMs : null,
      chapterTarget: null,
    };
  }

  if (timer.mode === "end_of_chapter" || timer.mode === "end_of_next_chapter") {
    const target = timer.chapterTarget as
      | {
          chapterId?: unknown;
          chapterTitle?: unknown;
          chapterIndex?: unknown;
          chapterStartMs?: unknown;
          chapterEndMs?: unknown;
        }
      | null
      | undefined;
    if (
      target &&
      typeof target.chapterId === "number" &&
      typeof target.chapterIndex === "number" &&
      typeof target.chapterStartMs === "number" &&
      typeof target.chapterEndMs === "number"
    ) {
      return {
        mode: timer.mode,
        libraryItemId: typeof timer.libraryItemId === "string" ? timer.libraryItemId : null,
        startedAtMs: typeof timer.startedAtMs === "number" ? timer.startedAtMs : Date.now(),
        endsAtMs: null,
        chapterTarget: {
          chapterId: target.chapterId,
          chapterTitle: typeof target.chapterTitle === "string" ? target.chapterTitle : "",
          chapterIndex: target.chapterIndex,
          chapterStartMs: target.chapterStartMs,
          chapterEndMs: target.chapterEndMs,
        },
      };
    }
  }

  return null;
};

export const sleepTimerStore = createStore<SleepTimerStoreState>()(
  persist(
    (set, get) => ({
      draftMinutes: DEFAULT_SLEEP_TIMER_MINUTES,
      customMinutePresets: DEFAULT_CUSTOM_SLEEP_TIMER_PRESETS,
      activeTimer: null,
      actions: {
        setDraftMinutes: (minutes) => set({ draftMinutes: clampTimerMinutes(minutes) }),
        adjustMinutesBy: (deltaMinutes) => {
          const state = get();
          const roundedDelta = Math.round(deltaMinutes);
          if (!roundedDelta) return;

          if (state.activeTimer?.mode === "minutes" && state.activeTimer.endsAtMs) {
            const remainingMs = Math.max(0, state.activeTimer.endsAtMs - Date.now());
            const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
            const nextMinutes = clampTimerMinutes(remainingMinutes + roundedDelta);
            set({
              draftMinutes: nextMinutes,
              activeTimer: createMinutesTimer(nextMinutes),
            });
            return;
          }

          set({ draftMinutes: clampTimerMinutes(state.draftMinutes + roundedDelta) });
        },
        startMinutesTimer: (minutes) => {
          const state = get();
          const nextMinutes = clampTimerMinutes(minutes ?? state.draftMinutes);
          set({
            draftMinutes: nextMinutes,
            activeTimer: createMinutesTimer(nextMinutes),
          });
        },
        startChapterTimer: (mode) => {
          const chapterTarget = resolveChapterTarget(mode);
          if (!chapterTarget) return;
          set({
            activeTimer: {
              mode,
              libraryItemId: playbackStore.getState().libraryItemId,
              startedAtMs: Date.now(),
              endsAtMs: null,
              chapterTarget,
            },
          });
        },
        stopTimer: () => set({ activeTimer: null }),
        addCustomPreset: (minutes) => {
          const normalized = normalizePresetMinutes(minutes);
          if (normalized === null) return;
          set((state) => ({
            customMinutePresets: normalizePresetList([...state.customMinutePresets, normalized]),
          }));
        },
        removeCustomPreset: (minutes) => {
          const normalized = normalizePresetMinutes(minutes);
          if (normalized === null) return;
          set((state) => ({
            customMinutePresets: state.customMinutePresets.filter((value) => value !== normalized),
          }));
        },
      },
    }),
    {
      name: "sleep-timer-store",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        draftMinutes: state.draftMinutes,
        customMinutePresets: state.customMinutePresets,
        activeTimer: state.activeTimer,
      }),
      version: 2,
      migrate: (persistedState) => {
        const state = (persistedState as Partial<SleepTimerStoreState> | undefined) ?? undefined;
        if (!state) {
          return {
            draftMinutes: DEFAULT_SLEEP_TIMER_MINUTES,
            customMinutePresets: DEFAULT_CUSTOM_SLEEP_TIMER_PRESETS,
            activeTimer: null,
          };
        }

        return {
          draftMinutes: clampTimerMinutes(state.draftMinutes ?? DEFAULT_SLEEP_TIMER_MINUTES),
          customMinutePresets: normalizePresetList(
            state.customMinutePresets ?? DEFAULT_CUSTOM_SLEEP_TIMER_PRESETS,
          ),
          activeTimer: normalizeActiveTimer(state.activeTimer),
        };
      },
    },
  ),
);

export const useSleepTimerStore = <T,>(selector: (state: SleepTimerStoreState) => T) =>
  useStore(sleepTimerStore, selector);

export const useSleepTimerActions = () => useSleepTimerStore((state) => state.actions);

export type SleepTimerStatus = {
  isActive: boolean;
  mode: SleepTimerMode | "off";
  title: string;
  subtitle: string;
  remainingMs: number | null;
  remainingMinutes: number | null;
};

export const resolveSleepTimerStatus = (
  activeTimer: SleepTimerSession | null,
  nowMs: number = Date.now(),
): SleepTimerStatus => {
  if (!activeTimer) {
    return {
      isActive: false,
      mode: "off",
      title: "Sleep timer off",
      subtitle: "Set a timer to pause playback later.",
      remainingMs: null,
      remainingMinutes: null,
    };
  }

  if (activeTimer.mode === "minutes") {
    const remainingMs = Math.max(0, (activeTimer.endsAtMs ?? nowMs) - nowMs);
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return {
      isActive: true,
      mode: "minutes",
      title: `Sleep in ${formatClock(remainingMs)}`,
      subtitle: `${remainingMinutes} min remaining`,
      remainingMs,
      remainingMinutes,
    };
  }

  if (activeTimer.mode === "end_of_chapter") {
    const chapterLabel = activeTimer.chapterTarget
      ? `chapter ${activeTimer.chapterTarget.chapterIndex + 1}`
      : "the current chapter";
    return {
      isActive: true,
      mode: "end_of_chapter",
      title: "Sleep at chapter end",
      subtitle: `Will pause at the end of ${chapterLabel}.`,
      remainingMs: null,
      remainingMinutes: null,
    };
  }

  const chapterLabel = activeTimer.chapterTarget
    ? `chapter ${activeTimer.chapterTarget.chapterIndex + 1}`
    : "the next chapter";
  return {
    isActive: true,
    mode: "end_of_next_chapter",
    title: "Sleep after next chapter",
    subtitle: `Locked to end of ${chapterLabel}.`,
    remainingMs: null,
    remainingMinutes: null,
  };
};

export const useSleepTimerStatus = () => {
  const activeTimer = useSleepTimerStore((state) => state.activeTimer);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (activeTimer?.mode !== "minutes") return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTimer?.mode, activeTimer?.endsAtMs]);

  return useMemo(() => resolveSleepTimerStatus(activeTimer, nowMs), [activeTimer, nowMs]);
};
