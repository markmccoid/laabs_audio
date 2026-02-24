import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "./mmkv-storage";
import type { PitchCorrectionQuality } from "../player/types";

export const DEFAULT_HOME_SHELF_ITEM_COUNT = 15;
export const MIN_HOME_SHELF_ITEM_COUNT = 5;
export const MAX_HOME_SHELF_ITEM_COUNT = 25;
export const DEFAULT_SEEK_BACKWARD_SECONDS = 15;
export const DEFAULT_SEEK_FORWARD_SECONDS = 30;
export const MIN_SKIP_SECONDS = 5;
export const MAX_SKIP_SECONDS = 120;

export type HomeShelfSettings = {
  isVisible: boolean;
  homeItemCount: number;
};

export type HomeShelvesScopeSettings = {
  shelfOrder: string[];
  shelfSettingsById: Record<string, HomeShelfSettings>;
};

export type DailyDiscoverShelf = {
  dateKey: string;
  seed: number;
  bookIds: string[];
  updatedAt: number;
};

export type BookProgressTimeDisplay = "elapsed" | "remaining";

const DEFAULT_HOME_SHELF_SETTINGS: HomeShelfSettings = {
  isVisible: true,
  homeItemCount: DEFAULT_HOME_SHELF_ITEM_COUNT,
};

const EMPTY_SCOPE_SETTINGS: HomeShelvesScopeSettings = {
  shelfOrder: [],
  shelfSettingsById: {},
};

const EMPTY_HOME_SHELVES_BY_SCOPE: Record<string, HomeShelvesScopeSettings> = {};

const normalizeScopeKey = (scopeKey: string | null) => {
  if (!scopeKey) return null;
  const normalized = scopeKey.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeShelfId = (shelfId: string) => shelfId.trim();

const dedupeShelfOrder = (ids: string[]) => {
  const unique = new Set<string>();
  const ordered: string[] = [];
  ids.forEach((id) => {
    const normalizedId = normalizeShelfId(id);
    if (!normalizedId || unique.has(normalizedId)) return;
    unique.add(normalizedId);
    ordered.push(normalizedId);
  });
  return ordered;
};

export const clampHomeShelfItemCount = (value: number) =>
  Math.max(MIN_HOME_SHELF_ITEM_COUNT, Math.min(MAX_HOME_SHELF_ITEM_COUNT, Math.round(value)));

export const clampSkipSeconds = (value: number) =>
  Math.max(MIN_SKIP_SECONDS, Math.min(MAX_SKIP_SECONDS, Math.round(value)));

const resolveScopeSettings = (
  homeShelvesByScope: Record<string, HomeShelvesScopeSettings>,
  scopeKey: string,
) => homeShelvesByScope[scopeKey] ?? EMPTY_SCOPE_SETTINGS;

export type SettingsState = {
  playbackRate: number;
  pitchCorrectionQuality: PitchCorrectionQuality;
  seekBackwardSeconds: number;
  seekForwardSeconds: number;
  defaultBookProgressTimeDisplay: BookProgressTimeDisplay;
  homeShelvesByScope: Record<string, HomeShelvesScopeSettings>;
  discoverShelfByScope: Record<string, DailyDiscoverShelf>;
  actions: {
    setPlaybackRate: (rate: number) => void;
    setPitchCorrectionQuality: (quality: PitchCorrectionQuality) => void;
    setSeekBackwardSeconds: (seconds: number) => void;
    setSeekForwardSeconds: (seconds: number) => void;
    setSkipSeconds: (seconds: number) => void;
    setDefaultBookProgressTimeDisplay: (display: BookProgressTimeDisplay) => void;
    setHomeShelfVisibility: (scopeKey: string | null, shelfId: string, isVisible: boolean) => void;
    setHomeShelfItemCount: (scopeKey: string | null, shelfId: string, homeItemCount: number) => void;
    setHomeShelfOrder: (scopeKey: string | null, orderedShelfIds: string[]) => void;
    clearHomeShelf: (scopeKey: string | null, shelfId: string) => void;
    setDailyDiscoverShelf: (
      scopeKey: string | null,
      payload: { dateKey: string; seed: number; bookIds: string[] },
    ) => void;
  };
};

export const settingsStore = createStore<SettingsState>()(
  persist(
    (set) => ({
      playbackRate: 1,
      pitchCorrectionQuality: "medium",
      seekBackwardSeconds: DEFAULT_SEEK_BACKWARD_SECONDS,
      seekForwardSeconds: DEFAULT_SEEK_FORWARD_SECONDS,
      defaultBookProgressTimeDisplay: "elapsed",
      homeShelvesByScope: {},
      discoverShelfByScope: {},
      actions: {
        setPlaybackRate: (playbackRate) => set({ playbackRate }),
        setPitchCorrectionQuality: (pitchCorrectionQuality) =>
          set({ pitchCorrectionQuality }),
        setSeekBackwardSeconds: (seekBackwardSeconds) =>
          set({ seekBackwardSeconds: clampSkipSeconds(seekBackwardSeconds) }),
        setSeekForwardSeconds: (seekForwardSeconds) =>
          set({ seekForwardSeconds: clampSkipSeconds(seekForwardSeconds) }),
        setSkipSeconds: (seconds) => {
          const clampedSeconds = clampSkipSeconds(seconds);
          set({
            seekBackwardSeconds: clampedSeconds,
            seekForwardSeconds: clampedSeconds,
          });
        },
        setDefaultBookProgressTimeDisplay: (defaultBookProgressTimeDisplay) =>
          set({ defaultBookProgressTimeDisplay }),
        setHomeShelfVisibility: (scopeKey, shelfId, isVisible) => {
          const normalizedScopeKey = normalizeScopeKey(scopeKey);
          const normalizedShelfId = normalizeShelfId(shelfId);
          if (!normalizedScopeKey || !normalizedShelfId) return;

          set((state) => {
            const scopeSettings = resolveScopeSettings(
              state.homeShelvesByScope,
              normalizedScopeKey,
            );
            const currentShelfSettings =
              scopeSettings.shelfSettingsById[normalizedShelfId] ?? DEFAULT_HOME_SHELF_SETTINGS;
            if (currentShelfSettings.isVisible === isVisible) return state;

            return {
              ...state,
              homeShelvesByScope: {
                ...state.homeShelvesByScope,
                [normalizedScopeKey]: {
                  shelfOrder: scopeSettings.shelfOrder,
                  shelfSettingsById: {
                    ...scopeSettings.shelfSettingsById,
                    [normalizedShelfId]: {
                      ...currentShelfSettings,
                      isVisible,
                    },
                  },
                },
              },
            };
          });
        },
        setHomeShelfItemCount: (scopeKey, shelfId, homeItemCount) => {
          const normalizedScopeKey = normalizeScopeKey(scopeKey);
          const normalizedShelfId = normalizeShelfId(shelfId);
          if (!normalizedScopeKey || !normalizedShelfId) return;

          const clampedCount = clampHomeShelfItemCount(homeItemCount);

          set((state) => {
            const scopeSettings = resolveScopeSettings(
              state.homeShelvesByScope,
              normalizedScopeKey,
            );
            const currentShelfSettings =
              scopeSettings.shelfSettingsById[normalizedShelfId] ?? DEFAULT_HOME_SHELF_SETTINGS;
            if (currentShelfSettings.homeItemCount === clampedCount) return state;

            return {
              ...state,
              homeShelvesByScope: {
                ...state.homeShelvesByScope,
                [normalizedScopeKey]: {
                  shelfOrder: scopeSettings.shelfOrder,
                  shelfSettingsById: {
                    ...scopeSettings.shelfSettingsById,
                    [normalizedShelfId]: {
                      ...currentShelfSettings,
                      homeItemCount: clampedCount,
                    },
                  },
                },
              },
            };
          });
        },
        setHomeShelfOrder: (scopeKey, orderedShelfIds) => {
          const normalizedScopeKey = normalizeScopeKey(scopeKey);
          if (!normalizedScopeKey) return;

          const nextOrder = dedupeShelfOrder(orderedShelfIds);

          set((state) => {
            const scopeSettings = resolveScopeSettings(
              state.homeShelvesByScope,
              normalizedScopeKey,
            );
            const currentOrder = scopeSettings.shelfOrder;
            const unchanged =
              currentOrder.length === nextOrder.length &&
              currentOrder.every((id, index) => id === nextOrder[index]);
            if (unchanged) return state;

            return {
              ...state,
              homeShelvesByScope: {
                ...state.homeShelvesByScope,
                [normalizedScopeKey]: {
                  ...scopeSettings,
                  shelfOrder: nextOrder,
                },
              },
            };
          });
        },
        clearHomeShelf: (scopeKey, shelfId) => {
          const normalizedScopeKey = normalizeScopeKey(scopeKey);
          const normalizedShelfId = normalizeShelfId(shelfId);
          if (!normalizedScopeKey || !normalizedShelfId) return;

          set((state) => {
            const scopeSettings = resolveScopeSettings(
              state.homeShelvesByScope,
              normalizedScopeKey,
            );
            const hasSettings = Boolean(scopeSettings.shelfSettingsById[normalizedShelfId]);
            const hasOrder = scopeSettings.shelfOrder.includes(normalizedShelfId);
            if (!hasSettings && !hasOrder) return state;

            const { [normalizedShelfId]: _removedShelfSettings, ...remainingShelfSettings } =
              scopeSettings.shelfSettingsById;
            const remainingOrder = scopeSettings.shelfOrder.filter(
              (id) => id !== normalizedShelfId,
            );

            return {
              ...state,
              homeShelvesByScope: {
                ...state.homeShelvesByScope,
                [normalizedScopeKey]: {
                  shelfOrder: remainingOrder,
                  shelfSettingsById: remainingShelfSettings,
                },
              },
            };
          });
        },
        setDailyDiscoverShelf: (scopeKey, payload) => {
          const normalizedScopeKey = normalizeScopeKey(scopeKey);
          const normalizedDateKey = payload.dateKey.trim();
          if (!normalizedScopeKey || !normalizedDateKey) return;

          const dedupedBookIds = dedupeShelfOrder(payload.bookIds);

          set((state) => {
            const existing = state.discoverShelfByScope[normalizedScopeKey];
            const unchanged =
              existing?.dateKey === normalizedDateKey &&
              existing?.seed === payload.seed &&
              existing?.bookIds.length === dedupedBookIds.length &&
              existing.bookIds.every((bookId, index) => bookId === dedupedBookIds[index]);

            if (unchanged) return state;

            return {
              ...state,
              discoverShelfByScope: {
                ...state.discoverShelfByScope,
                [normalizedScopeKey]: {
                  dateKey: normalizedDateKey,
                  seed: payload.seed,
                  bookIds: dedupedBookIds,
                  updatedAt: Date.now(),
                },
              },
            };
          });
        },
      },
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        playbackRate: state.playbackRate,
        pitchCorrectionQuality: state.pitchCorrectionQuality,
        seekBackwardSeconds: state.seekBackwardSeconds,
        seekForwardSeconds: state.seekForwardSeconds,
        defaultBookProgressTimeDisplay: state.defaultBookProgressTimeDisplay,
        homeShelvesByScope: state.homeShelvesByScope,
        discoverShelfByScope: state.discoverShelfByScope,
      }),
      version: 5,
      migrate: (persistedState, version) => {
        const state = (persistedState as Partial<SettingsState> | undefined) ?? undefined;

        if (!state) {
          return {
            playbackRate: 1,
            pitchCorrectionQuality: "medium",
            seekBackwardSeconds: DEFAULT_SEEK_BACKWARD_SECONDS,
            seekForwardSeconds: DEFAULT_SEEK_FORWARD_SECONDS,
            defaultBookProgressTimeDisplay: "elapsed",
            homeShelvesByScope: EMPTY_HOME_SHELVES_BY_SCOPE,
            discoverShelfByScope: {},
          };
        }

        return {
          playbackRate: state.playbackRate ?? 1,
          pitchCorrectionQuality: state.pitchCorrectionQuality ?? "medium",
          seekBackwardSeconds:
            version >= 5
              ? clampSkipSeconds(
                  state.seekBackwardSeconds ?? DEFAULT_SEEK_BACKWARD_SECONDS,
                )
              : DEFAULT_SEEK_BACKWARD_SECONDS,
          seekForwardSeconds:
            version >= 5
              ? clampSkipSeconds(state.seekForwardSeconds ?? DEFAULT_SEEK_FORWARD_SECONDS)
              : DEFAULT_SEEK_FORWARD_SECONDS,
          defaultBookProgressTimeDisplay:
            version >= 4
              ? state.defaultBookProgressTimeDisplay ?? "elapsed"
              : "elapsed",
          homeShelvesByScope:
            version >= 3
              ? state.homeShelvesByScope ?? EMPTY_HOME_SHELVES_BY_SCOPE
              : EMPTY_HOME_SHELVES_BY_SCOPE,
          discoverShelfByScope:
            version >= 4
              ? state.discoverShelfByScope ?? {}
              : {},
        };
      },
    }
  )
);

export const useSettingsStore = <T,>(selector: (state: SettingsState) => T) =>
  useStore(settingsStore, selector);

export const useSettingsActions = () =>
  useSettingsStore((state) => state.actions);

export const selectHomeShelfSettings = (
  state: SettingsState,
  scopeKey: string | null,
  shelfId: string,
): HomeShelfSettings => {
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  const normalizedShelfId = normalizeShelfId(shelfId);
  if (!normalizedScopeKey || !normalizedShelfId) return DEFAULT_HOME_SHELF_SETTINGS;

  return (
    state.homeShelvesByScope[normalizedScopeKey]?.shelfSettingsById[normalizedShelfId] ??
    DEFAULT_HOME_SHELF_SETTINGS
  );
};

export const selectHomeShelfOrder = (state: SettingsState, scopeKey: string | null) => {
  const normalizedScopeKey = normalizeScopeKey(scopeKey);
  if (!normalizedScopeKey) return [];
  return state.homeShelvesByScope[normalizedScopeKey]?.shelfOrder ?? [];
};
