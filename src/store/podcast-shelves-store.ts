import type { EpisodePlaylistItemIdentity } from "@/api/playlists-api";
import {
  episodeIdentityKey,
  type EpisodeIdentity,
} from "@/podcast/episode-identity";
import type { PodcastShelfEpisodeSnapshot } from "@/podcast/podcast-shelf-types";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "./mmkv-storage";

export type PodcastShelfScope = {
  userKey: string;
  libraryId: string;
};

export type PodcastDeviceEpisodeShelf = {
  kind: "deviceEpisode";
  id: string;
  name: string;
  episodeKeys: string[];
  createdAt: number;
  updatedAt: number;
};

export type PodcastPlaylistShelfSyncState =
  | "synced"
  | "pending"
  | "missing"
  | "unsynced";

export type PodcastPlaylistEpisodeShelf = {
  kind: "playlistEpisode";
  id: string;
  absPlaylistId: string;
  name: string;
  description: string | null;
  episodeKeys: string[];
  createdAt: number;
  updatedAt: number;
  serverUpdatedAt: number | null;
  lastServerSyncAt: number | null;
  missingOnServerAt: number | null;
  syncState: PodcastPlaylistShelfSyncState;
};

export type PodcastPlaylistOperationType =
  | "rename"
  | "addEpisodes"
  | "removeEpisodes"
  | "setEpisodes"
  | "delete";

export type PendingPodcastPlaylistOperation = {
  id: string;
  type: PodcastPlaylistOperationType;
  scopeKey: string;
  userKey: string;
  libraryId: string;
  shelfId: string;
  absPlaylistId: string;
  payload: {
    name?: string;
    episodes?: EpisodePlaylistItemIdentity[];
  };
  createdAt: number;
  attemptCount: number;
  lastError: string | null;
  permanentFailure: boolean;
};

type PodcastShelvesPersistedState = {
  deviceShelvesByScope: Record<string, PodcastDeviceEpisodeShelf[]>;
  playlistShelvesByScope: Record<string, PodcastPlaylistEpisodeShelf[]>;
  episodeSnapshotsByScope: Record<
    string,
    Record<string, PodcastShelfEpisodeSnapshot>
  >;
  suppressedPlaylistIdsByScope: Record<string, string[]>;
  pendingPlaylistOperationsByScope: Record<
    string,
    PendingPodcastPlaylistOperation[]
  >;
  downloadedEpisodeOrderByScope: Record<string, string[]>;
};

export type PodcastPlaylistConversionInput = {
  name: string;
  episodes: PodcastShelfEpisodeSnapshot[];
};

export type PodcastPlaylistConversionResult = {
  absPlaylistId: string;
  name?: string;
  description?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type PodcastShelvesState = PodcastShelvesPersistedState & {
  actions: {
    createDeviceShelf: (
      name: string,
      scope: PodcastShelfScope,
    ) => string | null;
    renameShelf: (
      shelfId: string,
      name: string,
      scope: PodcastShelfScope,
    ) => boolean;
    deleteShelf: (shelfId: string, scope: PodcastShelfScope) => boolean;
    addEpisodeToShelf: (
      shelfId: string,
      snapshot: PodcastShelfEpisodeSnapshot,
      scope: PodcastShelfScope,
    ) => boolean;
    removeEpisodeFromShelf: (
      shelfId: string,
      identity: EpisodeIdentity,
      scope: PodcastShelfScope,
    ) => boolean;
    reorderShelfEpisodes: (
      shelfId: string,
      orderedIdentities: EpisodeIdentity[],
      scope: PodcastShelfScope,
    ) => boolean;
    upsertPlaylistShelf: (
      shelf: Omit<PodcastPlaylistEpisodeShelf, "kind" | "id">,
      snapshots: PodcastShelfEpisodeSnapshot[],
      scope: PodcastShelfScope,
    ) => string | null;
    suppressPlaylistShelf: (
      shelfId: string,
      scope: PodcastShelfScope,
    ) => void;
    restorePlaylistShelf: (
      shelfId: string,
      scope: PodcastShelfScope,
    ) => void;
    reconcileDownloadedEpisodeOrder: (
      identities: EpisodeIdentity[],
      scope: PodcastShelfScope,
    ) => string[];
    reorderDownloadedEpisodes: (
      identities: EpisodeIdentity[],
      scope: PodcastShelfScope,
    ) => boolean;
    convertDeviceShelfToPlaylist: (
      shelfId: string,
      convert: (
        input: PodcastPlaylistConversionInput,
      ) => Promise<PodcastPlaylistConversionResult>,
      scope: PodcastShelfScope,
    ) => Promise<string | null>;
  };
};

const EMPTY_DEVICE_SHELVES: PodcastDeviceEpisodeShelf[] = [];
const EMPTY_PLAYLIST_SHELVES: PodcastPlaylistEpisodeShelf[] = [];
const EMPTY_SNAPSHOTS: Record<string, PodcastShelfEpisodeSnapshot> = {};
const EMPTY_IDS: string[] = [];

export const toPodcastShelfScopeKey = (scope: PodcastShelfScope) => {
  const userKey = scope.userKey.trim();
  const libraryId = scope.libraryId.trim();
  return userKey && libraryId ? `${userKey}::${libraryId}` : null;
};

export const toPodcastPlaylistShelfId = (absPlaylistId: string) => {
  const id = absPlaylistId.trim();
  return id ? `playlist:${id}` : null;
};

const createDeviceShelfId = () =>
  `podcast-shelf:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

const createDefaultState = (): PodcastShelvesPersistedState => ({
  deviceShelvesByScope: {},
  playlistShelvesByScope: {},
  episodeSnapshotsByScope: {},
  suppressedPlaylistIdsByScope: {},
  pendingPlaylistOperationsByScope: {},
  downloadedEpisodeOrderByScope: {},
});

const normalizeSnapshot = (
  snapshot: PodcastShelfEpisodeSnapshot,
): PodcastShelfEpisodeSnapshot | null => {
  const key = episodeIdentityKey(snapshot);
  if (!key) return null;
  return {
    libraryItemId: snapshot.libraryItemId.trim(),
    episodeId: snapshot.episodeId.trim(),
    title: snapshot.title.trim() || "Episode",
    podcastTitle: snapshot.podcastTitle.trim() || "Podcast",
    cover: snapshot.cover ?? null,
    coverFull: snapshot.coverFull ?? null,
    durationSeconds: Number.isFinite(snapshot.durationSeconds)
      ? Math.max(0, snapshot.durationSeconds)
      : 0,
    publishedAt:
      snapshot.publishedAt !== null && Number.isFinite(snapshot.publishedAt)
        ? snapshot.publishedAt
        : null,
  };
};

const dedupeKeys = (keys: readonly (string | null)[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  keys.forEach((key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(key);
  });
  return result;
};

const reorderKnownKeys = (current: string[], requested: string[]) => {
  const currentSet = new Set(current);
  const requestedKnown = dedupeKeys(requested).filter((key) =>
    currentSet.has(key),
  );
  const requestedSet = new Set(requestedKnown);
  return [...requestedKnown, ...current.filter((key) => !requestedSet.has(key))];
};

const pruneSnapshots = (
  state: PodcastShelvesPersistedState,
  scopeKey: string,
): Record<string, PodcastShelfEpisodeSnapshot> => {
  const referenced = new Set<string>();
  (state.deviceShelvesByScope[scopeKey] ?? []).forEach((shelf) =>
    shelf.episodeKeys.forEach((key) => referenced.add(key)),
  );
  (state.playlistShelvesByScope[scopeKey] ?? []).forEach((shelf) =>
    shelf.episodeKeys.forEach((key) => referenced.add(key)),
  );
  return Object.fromEntries(
    Object.entries(state.episodeSnapshotsByScope[scopeKey] ?? {}).filter(
      ([key]) => referenced.has(key),
    ),
  );
};

const mergePersistedState = (
  persistedState: unknown,
  currentState: PodcastShelvesState,
): PodcastShelvesState => {
  const persisted =
    persistedState && typeof persistedState === "object"
      ? (persistedState as Partial<PodcastShelvesPersistedState>)
      : {};
  const defaults = createDefaultState();
  return {
    ...currentState,
    deviceShelvesByScope:
      persisted.deviceShelvesByScope ?? defaults.deviceShelvesByScope,
    playlistShelvesByScope:
      persisted.playlistShelvesByScope ?? defaults.playlistShelvesByScope,
    episodeSnapshotsByScope:
      persisted.episodeSnapshotsByScope ?? defaults.episodeSnapshotsByScope,
    suppressedPlaylistIdsByScope:
      persisted.suppressedPlaylistIdsByScope ??
      defaults.suppressedPlaylistIdsByScope,
    pendingPlaylistOperationsByScope:
      persisted.pendingPlaylistOperationsByScope ??
      defaults.pendingPlaylistOperationsByScope,
    downloadedEpisodeOrderByScope:
      persisted.downloadedEpisodeOrderByScope ??
      defaults.downloadedEpisodeOrderByScope,
  };
};

export const podcastShelvesStore = createStore<PodcastShelvesState>()(
  persist(
    (set, get) => ({
      ...createDefaultState(),
      actions: {
        createDeviceShelf: (name, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          const normalizedName = name.trim();
          if (!scopeKey || !normalizedName) return null;
          const now = Date.now();
          const shelf: PodcastDeviceEpisodeShelf = {
            kind: "deviceEpisode",
            id: createDeviceShelfId(),
            name: normalizedName,
            episodeKeys: [],
            createdAt: now,
            updatedAt: now,
          };
          set((state) => ({
            deviceShelvesByScope: {
              ...state.deviceShelvesByScope,
              [scopeKey]: [
                ...(state.deviceShelvesByScope[scopeKey] ?? []),
                shelf,
              ],
            },
          }));
          return shelf.id;
        },

        renameShelf: (shelfId, name, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          const normalizedName = name.trim();
          if (!scopeKey || !normalizedName) return false;
          let changed = false;
          set((state) => ({
            deviceShelvesByScope: {
              ...state.deviceShelvesByScope,
              [scopeKey]: (state.deviceShelvesByScope[scopeKey] ?? []).map(
                (shelf) => {
                  if (shelf.id !== shelfId || shelf.name === normalizedName)
                    return shelf;
                  changed = true;
                  return { ...shelf, name: normalizedName, updatedAt: Date.now() };
                },
              ),
            },
            playlistShelvesByScope: {
              ...state.playlistShelvesByScope,
              [scopeKey]: (state.playlistShelvesByScope[scopeKey] ?? []).map(
                (shelf) => {
                  if (shelf.id !== shelfId || shelf.name === normalizedName)
                    return shelf;
                  changed = true;
                  return {
                    ...shelf,
                    name: normalizedName,
                    updatedAt: Date.now(),
                    syncState: "pending" as const,
                  };
                },
              ),
            },
          }));
          return changed;
        },

        deleteShelf: (shelfId, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return false;
          let changed = false;
          set((state) => {
            const deviceShelves = (
              state.deviceShelvesByScope[scopeKey] ?? []
            ).filter((shelf) => {
              if (shelf.id !== shelfId) return true;
              changed = true;
              return false;
            });
            const playlistShelves = (
              state.playlistShelvesByScope[scopeKey] ?? []
            ).filter((shelf) => {
              if (shelf.id !== shelfId) return true;
              changed = true;
              return false;
            });
            if (!changed) return state;
            const next = {
              ...state,
              deviceShelvesByScope: {
                ...state.deviceShelvesByScope,
                [scopeKey]: deviceShelves,
              },
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: playlistShelves,
              },
              suppressedPlaylistIdsByScope: {
                ...state.suppressedPlaylistIdsByScope,
                [scopeKey]: (
                  state.suppressedPlaylistIdsByScope[scopeKey] ?? []
                ).filter((id) => id !== shelfId),
              },
            };
            return {
              ...next,
              episodeSnapshotsByScope: {
                ...state.episodeSnapshotsByScope,
                [scopeKey]: pruneSnapshots(next, scopeKey),
              },
            };
          });
          return changed;
        },

        addEpisodeToShelf: (shelfId, candidate, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          const snapshot = normalizeSnapshot(candidate);
          const key = snapshot ? episodeIdentityKey(snapshot) : null;
          if (!scopeKey || !snapshot || !key) return false;
          let changed = false;
          set((state) => {
            const suppressed = new Set(
              state.suppressedPlaylistIdsByScope[scopeKey] ?? [],
            );
            const update = <
              T extends PodcastDeviceEpisodeShelf | PodcastPlaylistEpisodeShelf,
            >(
              shelf: T,
            ): T => {
              if (
                shelf.id !== shelfId ||
                shelf.episodeKeys.includes(key) ||
                (shelf.kind === "playlistEpisode" &&
                  (suppressed.has(shelf.id) || shelf.syncState === "missing"))
              )
                return shelf;
              changed = true;
              return {
                ...shelf,
                episodeKeys: [...shelf.episodeKeys, key],
                updatedAt: Date.now(),
                ...(shelf.kind === "playlistEpisode"
                  ? { syncState: "pending" as const }
                  : {}),
              };
            };
            const deviceShelves = (
              state.deviceShelvesByScope[scopeKey] ?? []
            ).map(update);
            const playlistShelves = (
              state.playlistShelvesByScope[scopeKey] ?? []
            ).map(update);
            if (!changed) return state;
            return {
              ...state,
              deviceShelvesByScope: {
                ...state.deviceShelvesByScope,
                [scopeKey]: deviceShelves,
              },
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: playlistShelves,
              },
              episodeSnapshotsByScope: {
                ...state.episodeSnapshotsByScope,
                [scopeKey]: {
                  ...(state.episodeSnapshotsByScope[scopeKey] ?? {}),
                  [key]: snapshot,
                },
              },
            };
          });
          return changed;
        },

        removeEpisodeFromShelf: (shelfId, identity, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          const key = episodeIdentityKey(identity);
          if (!scopeKey || !key) return false;
          let changed = false;
          set((state) => {
            const update = <
              T extends PodcastDeviceEpisodeShelf | PodcastPlaylistEpisodeShelf,
            >(
              shelf: T,
            ): T => {
              if (shelf.id !== shelfId || !shelf.episodeKeys.includes(key))
                return shelf;
              changed = true;
              return {
                ...shelf,
                episodeKeys: shelf.episodeKeys.filter(
                  (episodeKey) => episodeKey !== key,
                ),
                updatedAt: Date.now(),
                ...(shelf.kind === "playlistEpisode"
                  ? { syncState: "pending" as const }
                  : {}),
              };
            };
            const next = {
              ...state,
              deviceShelvesByScope: {
                ...state.deviceShelvesByScope,
                [scopeKey]: (
                  state.deviceShelvesByScope[scopeKey] ?? []
                ).map(update),
              },
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: (
                  state.playlistShelvesByScope[scopeKey] ?? []
                ).map(update),
              },
            };
            if (!changed) return state;
            return {
              ...next,
              episodeSnapshotsByScope: {
                ...state.episodeSnapshotsByScope,
                [scopeKey]: pruneSnapshots(next, scopeKey),
              },
            };
          });
          return changed;
        },

        reorderShelfEpisodes: (shelfId, identities, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return false;
          const requested = dedupeKeys(
            identities.map((identity) => episodeIdentityKey(identity)),
          );
          let changed = false;
          set((state) => {
            const update = <
              T extends PodcastDeviceEpisodeShelf | PodcastPlaylistEpisodeShelf,
            >(
              shelf: T,
            ): T => {
              if (shelf.id !== shelfId) return shelf;
              const episodeKeys = reorderKnownKeys(
                shelf.episodeKeys,
                requested,
              );
              if (
                episodeKeys.every(
                  (key, index) => key === shelf.episodeKeys[index],
                )
              )
                return shelf;
              changed = true;
              return {
                ...shelf,
                episodeKeys,
                updatedAt: Date.now(),
                ...(shelf.kind === "playlistEpisode"
                  ? { syncState: "pending" as const }
                  : {}),
              };
            };
            return {
              deviceShelvesByScope: {
                ...state.deviceShelvesByScope,
                [scopeKey]: (
                  state.deviceShelvesByScope[scopeKey] ?? []
                ).map(update),
              },
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: (
                  state.playlistShelvesByScope[scopeKey] ?? []
                ).map(update),
              },
            };
          });
          return changed;
        },

        upsertPlaylistShelf: (input, snapshots, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          const shelfId = toPodcastPlaylistShelfId(input.absPlaylistId);
          if (!scopeKey || !shelfId) return null;
          const normalizedSnapshots = snapshots
            .map(normalizeSnapshot)
            .filter(
              (snapshot): snapshot is PodcastShelfEpisodeSnapshot =>
                snapshot !== null,
            );
          const normalizedByKey = Object.fromEntries(
            normalizedSnapshots.map((snapshot) => [
              episodeIdentityKey(snapshot) as string,
              snapshot,
            ]),
          );
          const incomingKeys = dedupeKeys(
            input.episodeKeys.map((key) => key.trim() || null),
          );
          set((state) => {
            const current = state.playlistShelvesByScope[scopeKey] ?? [];
            const previous = current.find((shelf) => shelf.id === shelfId);
            const shelf: PodcastPlaylistEpisodeShelf = {
              ...input,
              kind: "playlistEpisode",
              id: shelfId,
              episodeKeys: incomingKeys,
              createdAt: previous?.createdAt ?? input.createdAt,
            };
            return {
              playlistShelvesByScope: {
                ...state.playlistShelvesByScope,
                [scopeKey]: previous
                  ? current.map((candidate) =>
                      candidate.id === shelfId ? shelf : candidate,
                    )
                  : [...current, shelf],
              },
              episodeSnapshotsByScope: {
                ...state.episodeSnapshotsByScope,
                [scopeKey]: {
                  ...(state.episodeSnapshotsByScope[scopeKey] ?? {}),
                  ...normalizedByKey,
                },
              },
            };
          });
          return shelfId;
        },

        suppressPlaylistShelf: (shelfId, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return;
          set((state) => {
            const ids = state.suppressedPlaylistIdsByScope[scopeKey] ?? [];
            if (ids.includes(shelfId)) return state;
            return {
              suppressedPlaylistIdsByScope: {
                ...state.suppressedPlaylistIdsByScope,
                [scopeKey]: [...ids, shelfId],
              },
            };
          });
        },

        restorePlaylistShelf: (shelfId, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return;
          set((state) => ({
            suppressedPlaylistIdsByScope: {
              ...state.suppressedPlaylistIdsByScope,
              [scopeKey]: (
                state.suppressedPlaylistIdsByScope[scopeKey] ?? []
              ).filter((id) => id !== shelfId),
            },
          }));
        },

        reconcileDownloadedEpisodeOrder: (identities, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return [];
          const available = dedupeKeys(
            identities.map((identity) => episodeIdentityKey(identity)),
          );
          const availableSet = new Set(available);
          const stored = get().downloadedEpisodeOrderByScope[scopeKey] ?? [];
          const ordered = [
            ...stored.filter((key) => availableSet.has(key)),
            ...available.filter((key) => !stored.includes(key)),
          ];
          if (
            ordered.length === stored.length &&
            ordered.every((key, index) => key === stored[index])
          )
            return ordered;
          set((state) => ({
            downloadedEpisodeOrderByScope: {
              ...state.downloadedEpisodeOrderByScope,
              [scopeKey]: ordered,
            },
          }));
          return ordered;
        },

        reorderDownloadedEpisodes: (identities, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return false;
          const requested = dedupeKeys(
            identities.map((identity) => episodeIdentityKey(identity)),
          );
          const current = get().downloadedEpisodeOrderByScope[scopeKey] ?? [];
          const ordered = current.length
            ? reorderKnownKeys(current, requested)
            : requested;
          if (
            ordered.length === current.length &&
            ordered.every((key, index) => key === current[index])
          )
            return false;
          set((state) => ({
            downloadedEpisodeOrderByScope: {
              ...state.downloadedEpisodeOrderByScope,
              [scopeKey]: ordered,
            },
          }));
          return true;
        },

        convertDeviceShelfToPlaylist: async (shelfId, convert, scope) => {
          const scopeKey = toPodcastShelfScopeKey(scope);
          if (!scopeKey) return null;
          const before = get();
          const shelf = (before.deviceShelvesByScope[scopeKey] ?? []).find(
            (candidate) => candidate.id === shelfId,
          );
          if (!shelf) return null;
          const snapshots = before.episodeSnapshotsByScope[scopeKey] ?? {};
          const episodes = shelf.episodeKeys
            .map((key) => snapshots[key])
            .filter(
              (snapshot): snapshot is PodcastShelfEpisodeSnapshot =>
                snapshot != null,
            );

          let converted: PodcastPlaylistConversionResult;
          try {
            converted = await convert({ name: shelf.name, episodes });
          } catch {
            return null;
          }
          const playlistId = toPodcastPlaylistShelfId(converted.absPlaylistId);
          if (!playlistId) return null;

          // Do not apply a late result if this scope/shelf changed while the
          // network conversion was in flight.
          const current = get();
          const currentShelf = (
            current.deviceShelvesByScope[scopeKey] ?? []
          ).find((candidate) => candidate.id === shelfId);
          if (
            !currentShelf ||
            currentShelf.updatedAt !== shelf.updatedAt ||
            currentShelf.episodeKeys.join("\0") !== shelf.episodeKeys.join("\0")
          )
            return null;

          const now = Date.now();
          set((state) => ({
            deviceShelvesByScope: {
              ...state.deviceShelvesByScope,
              [scopeKey]: (
                state.deviceShelvesByScope[scopeKey] ?? []
              ).filter((candidate) => candidate.id !== shelfId),
            },
            playlistShelvesByScope: {
              ...state.playlistShelvesByScope,
              [scopeKey]: [
                ...(state.playlistShelvesByScope[scopeKey] ?? []),
                {
                  kind: "playlistEpisode",
                  id: playlistId,
                  absPlaylistId: converted.absPlaylistId.trim(),
                  name: converted.name?.trim() || shelf.name,
                  description: converted.description ?? null,
                  episodeKeys: [...shelf.episodeKeys],
                  createdAt: converted.createdAt ?? now,
                  updatedAt: now,
                  serverUpdatedAt: converted.updatedAt ?? null,
                  lastServerSyncAt: now,
                  missingOnServerAt: null,
                  syncState: "synced",
                },
              ],
            },
          }));
          return playlistId;
        },
      },
    }),
    {
      name: "laabs-podcast-shelves",
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: (state) => ({
        deviceShelvesByScope: state.deviceShelvesByScope,
        playlistShelvesByScope: state.playlistShelvesByScope,
        episodeSnapshotsByScope: state.episodeSnapshotsByScope,
        suppressedPlaylistIdsByScope: state.suppressedPlaylistIdsByScope,
        pendingPlaylistOperationsByScope:
          state.pendingPlaylistOperationsByScope,
        downloadedEpisodeOrderByScope: state.downloadedEpisodeOrderByScope,
      }),
      merge: mergePersistedState,
    },
  ),
);

export const usePodcastShelvesStore = <T,>(
  selector: (state: PodcastShelvesState) => T,
) => useStore(podcastShelvesStore, selector);

export const usePodcastShelvesActions = () =>
  usePodcastShelvesStore((state) => state.actions);

export const selectPodcastDeviceShelves = (
  state: PodcastShelvesState,
  scopeKey: string | null,
) => (scopeKey ? state.deviceShelvesByScope[scopeKey] ?? EMPTY_DEVICE_SHELVES : EMPTY_DEVICE_SHELVES);

export const selectPodcastPlaylistShelves = (
  state: PodcastShelvesState,
  scopeKey: string | null,
) =>
  scopeKey
    ? state.playlistShelvesByScope[scopeKey] ?? EMPTY_PLAYLIST_SHELVES
    : EMPTY_PLAYLIST_SHELVES;

export const selectPodcastShelfSnapshots = (
  state: PodcastShelvesState,
  scopeKey: string | null,
) =>
  scopeKey
    ? state.episodeSnapshotsByScope[scopeKey] ?? EMPTY_SNAPSHOTS
    : EMPTY_SNAPSHOTS;

export const selectSuppressedPodcastPlaylistIds = (
  state: PodcastShelvesState,
  scopeKey: string | null,
) =>
  scopeKey
    ? state.suppressedPlaylistIdsByScope[scopeKey] ?? EMPTY_IDS
    : EMPTY_IDS;
