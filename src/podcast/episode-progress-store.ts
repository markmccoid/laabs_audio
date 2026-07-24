import { createStore } from "zustand/vanilla";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStorage } from "@/store/mmkv-storage";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import type { EpisodeProgressSyncIntentRecord } from "@/podcast/episode-progress-facade";

type EpisodeProgressState = {
  pendingByUser: Record<string, Record<string, EpisodeProgressSyncIntentRecord>>;
  actions: {
    recordIntent: (
      userKey: string,
      intent: EpisodeProgressSyncIntentRecord,
    ) => EpisodeProgressSyncIntentRecord;
    clearIntent: (
      userKey: string,
      libraryItemId: string,
      episodeId: string,
      syncedThroughUpdatedAt?: number,
    ) => void;
    getIntent: (
      userKey: string,
      libraryItemId: string,
      episodeId: string,
    ) => EpisodeProgressSyncIntentRecord | null;
    markUnmatched: (userKey: string, libraryItemId: string, episodeId: string) => void;
  };
};

const createIntentId = () =>
  `episode_progress_intent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const episodeProgressStore = createStore<EpisodeProgressState>()(
  persist(
    (set, get) => ({
      pendingByUser: {},
      actions: {
        recordIntent: (userKey, intent) => {
          const key = episodeIdentityKey(intent);
          if (!key) return intent;
          const previous = get().pendingByUser[userKey]?.[key];
          const next: EpisodeProgressSyncIntentRecord = {
            ...intent,
            intentId: previous?.intentId ?? intent.intentId ?? createIntentId(),
            status: intent.status ?? "pending",
          };
          set((state) => ({
            pendingByUser: {
              ...state.pendingByUser,
              [userKey]: {
                ...(state.pendingByUser[userKey] ?? {}),
                [key]: next,
              },
            },
          }));
          return next;
        },
        clearIntent: (userKey, libraryItemId, episodeId, syncedThroughUpdatedAt) => {
          const key = episodeIdentityKey({ libraryItemId, episodeId });
          if (!key) return;
          const existing = get().pendingByUser[userKey]?.[key];
          if (!existing) return;
          if (
            typeof syncedThroughUpdatedAt === "number" &&
            existing.updatedAt > syncedThroughUpdatedAt
          ) {
            return;
          }
          set((state) => {
            const queue = { ...(state.pendingByUser[userKey] ?? {}) };
            delete queue[key];
            return {
              pendingByUser: {
                ...state.pendingByUser,
                [userKey]: queue,
              },
            };
          });
        },
        getIntent: (userKey, libraryItemId, episodeId) => {
          const key = episodeIdentityKey({ libraryItemId, episodeId });
          if (!key) return null;
          return get().pendingByUser[userKey]?.[key] ?? null;
        },
        markUnmatched: (userKey, libraryItemId, episodeId) => {
          const key = episodeIdentityKey({ libraryItemId, episodeId });
          if (!key) return;
          const existing = get().pendingByUser[userKey]?.[key];
          if (!existing) return;
          set((state) => ({
            pendingByUser: {
              ...state.pendingByUser,
              [userKey]: {
                ...(state.pendingByUser[userKey] ?? {}),
                [key]: { ...existing, status: "unmatched" },
              },
            },
          }));
        },
      },
    }),
    {
      name: "episode-progress-sync-intents",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({ pendingByUser: state.pendingByUser }),
    },
  ),
);
