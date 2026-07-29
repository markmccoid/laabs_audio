import { useAuthStore } from "@/auth/auth-store";
import {
  episodeIdentityKey,
  isSameEpisodeIdentity,
  type EpisodeIdentity,
} from "@/podcast/episode-identity";
import {
  selectEpisodeDownloadOwnerUserId,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { mmkvStorage } from "@/store/mmkv-storage";
import { useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";

export type EpisodeBookmarkKind = "point" | "clip";
export type EpisodeBookmarkServerStatus = "unsupported";

export type EpisodeBookmarkRecord = {
  id: string;
  userId: string;
  identity: EpisodeIdentity;
  kind: EpisodeBookmarkKind;
  startTimeSeconds: number;
  endTimeSeconds?: number;
  title: string;
  note?: string | null;
  createdAt: number;
  updatedAt: number;
  serverStatus: EpisodeBookmarkServerStatus;
};

export type SaveEpisodeBookmarkInput = {
  id?: string | null;
  userId: string;
  identity: EpisodeIdentity;
  kind: EpisodeBookmarkKind;
  startTimeSeconds: number;
  endTimeSeconds?: number | null;
  title: string;
  note?: string | null;
  createdAt?: number;
};

type EpisodeBookmarksPersistedState = {
  recordsByUser: Record<string, Record<string, EpisodeBookmarkRecord>>;
};

type EpisodeBookmarksState = EpisodeBookmarksPersistedState & {
  actions: {
    save: (input: SaveEpisodeBookmarkInput) => EpisodeBookmarkRecord;
    remove: (userId: string, bookmarkId: string) => void;
    clearForEpisode: (userId: string, identity: EpisodeIdentity) => void;
  };
};

const normalizeSeconds = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

const createEpisodeBookmarkId = () =>
  `episode_bookmark_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeInput = (
  input: SaveEpisodeBookmarkInput,
  existing?: EpisodeBookmarkRecord | null,
): EpisodeBookmarkRecord => {
  const userId = input.userId.trim();
  const key = episodeIdentityKey(input.identity);
  const title = input.title.trim();
  if (!userId || !key) throw new Error("Episode bookmark requires an owner and Episode Identity");
  if (!title) throw new Error("Episode bookmark requires a title");

  const startTimeSeconds = normalizeSeconds(input.startTimeSeconds);
  const requestedEnd =
    typeof input.endTimeSeconds === "number" ? normalizeSeconds(input.endTimeSeconds) : null;
  const isClip = input.kind === "clip" && requestedEnd !== null && requestedEnd > startTimeSeconds;
  const now = Date.now();

  return {
    id: existing?.id ?? input.id ?? createEpisodeBookmarkId(),
    userId,
    identity: {
      libraryItemId: input.identity.libraryItemId.trim(),
      episodeId: input.identity.episodeId.trim(),
    },
    kind: isClip ? "clip" : "point",
    startTimeSeconds,
    ...(isClip ? { endTimeSeconds: requestedEnd } : {}),
    title,
    note: input.note?.trim() || null,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
    serverStatus: "unsupported",
  };
};

export const upsertEpisodeBookmarkRecord = (
  state: EpisodeBookmarksPersistedState,
  input: SaveEpisodeBookmarkInput,
): { state: EpisodeBookmarksPersistedState; record: EpisodeBookmarkRecord } => {
  const userId = input.userId.trim();
  const existing = input.id ? state.recordsByUser[userId]?.[input.id] : null;
  const record = normalizeInput(input, existing);
  return {
    record,
    state: {
      recordsByUser: {
        ...state.recordsByUser,
        [record.userId]: {
          ...(state.recordsByUser[record.userId] ?? {}),
          [record.id]: record,
        },
      },
    },
  };
};

export const removeEpisodeBookmarkRecord = (
  state: EpisodeBookmarksPersistedState,
  userId: string,
  bookmarkId: string,
): EpisodeBookmarksPersistedState => {
  const recordsForUser = state.recordsByUser[userId] ?? {};
  if (!recordsForUser[bookmarkId]) return state;
  const { [bookmarkId]: _removed, ...remaining } = recordsForUser;
  return {
    recordsByUser: {
      ...state.recordsByUser,
      [userId]: remaining,
    },
  };
};

const createDefaultState = (): EpisodeBookmarksPersistedState => ({ recordsByUser: {} });

export const episodeBookmarksStore = createStore<EpisodeBookmarksState>()(
  persist(
    (set, get) => ({
      ...createDefaultState(),
      actions: {
        save: (input) => {
          const result = upsertEpisodeBookmarkRecord(get(), input);
          set(result.state);
          return result.record;
        },
        remove: (userId, bookmarkId) => {
          set((state) => removeEpisodeBookmarkRecord(state, userId, bookmarkId));
        },
        clearForEpisode: (userId, identity) => {
          set((state) => {
            const recordsForUser = state.recordsByUser[userId] ?? {};
            const remaining = Object.fromEntries(
              Object.entries(recordsForUser).filter(
                ([, record]) => !isSameEpisodeIdentity(record.identity, identity),
              ),
            );
            return {
              recordsByUser: {
                ...state.recordsByUser,
                [userId]: remaining,
              },
            };
          });
        },
      },
    }),
    {
      name: "episode-bookmarks",
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: (state) => ({ recordsByUser: state.recordsByUser }),
      merge: (persisted, current) => ({
        ...current,
        recordsByUser:
          (persisted as Partial<EpisodeBookmarksPersistedState> | undefined)?.recordsByUser ?? {},
      }),
    },
  ),
);

export const useEpisodeBookmarksStore = <T,>(selector: (state: EpisodeBookmarksState) => T) =>
  useStore(episodeBookmarksStore, selector);

export const useEpisodeBookmarkActions = () =>
  useEpisodeBookmarksStore((state) => state.actions);

export const selectEpisodeBookmarks = (
  state: Pick<EpisodeBookmarksState, "recordsByUser">,
  userId: string | null | undefined,
  identity: EpisodeIdentity,
) => {
  if (!userId || !episodeIdentityKey(identity)) return [];
  return Object.values(state.recordsByUser[userId] ?? {})
    .filter((record) => isSameEpisodeIdentity(record.identity, identity))
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
};

export const selectEpisodeBookmark = (
  state: Pick<EpisodeBookmarksState, "recordsByUser">,
  userId: string | null | undefined,
  bookmarkId: string | null | undefined,
) => (userId && bookmarkId ? (state.recordsByUser[userId]?.[bookmarkId] ?? null) : null);

const EMPTY_EPISODE_BOOKMARK_RECORDS: Record<string, EpisodeBookmarkRecord> = {};

export const useEpisodeBookmarks = (
  userId: string | null | undefined,
  identity: EpisodeIdentity,
) => {
  const recordsForUser = useEpisodeBookmarksStore((state) =>
    userId ? (state.recordsByUser[userId] ?? EMPTY_EPISODE_BOOKMARK_RECORDS) : EMPTY_EPISODE_BOOKMARK_RECORDS,
  );
  const { libraryItemId, episodeId } = identity;

  return useMemo(
    () =>
      Object.values(recordsForUser)
        .filter((record) =>
          isSameEpisodeIdentity(record.identity, { libraryItemId, episodeId }),
        )
        .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds),
    [episodeId, libraryItemId, recordsForUser],
  );
};

export const useResolvedEpisodeListeningOwnerKey = (
  identity?: EpisodeIdentity | null,
): string | null => {
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUserId = useAuthStore((state) => state.storedUserId);
  const downloadOwnerUserId = useDeviceEpisodeDownloadsStore((state) =>
    identity ? selectEpisodeDownloadOwnerUserId(state, identity) : null,
  );
  return activeLibraryUserKey ?? storedUserId ?? downloadOwnerUserId;
};
