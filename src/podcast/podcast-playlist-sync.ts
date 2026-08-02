import {
  AbsApiError,
  AbsOfflineError,
  AbsServerUnavailableError,
} from "@/api/abs-client";
import {
  playlistsApi,
  type EpisodePlaylistItemIdentity,
  type PlaylistSummary,
} from "@/api/playlists-api";
import {
  episodeIdentityKey,
} from "./episode-identity";
import {
  podcastShelvesStore,
  toPodcastPlaylistShelfId,
  toPodcastShelfScopeKey,
  type PendingPodcastPlaylistOperation,
  type PodcastPlaylistEpisodeShelf,
  type PodcastPlaylistOperationType,
  type PodcastShelfScope,
} from "@/store/podcast-shelves-store";

export type PodcastPlaylistTransport = Pick<
  typeof playlistsApi,
  | "getPlaylist"
  | "renamePlaylist"
  | "setEpisodePlaylistItems"
  | "deletePlaylist"
>;

export type QueuePodcastPlaylistOperationInput = {
  type: PodcastPlaylistOperationType;
  shelfId: string;
  absPlaylistId: string;
  payload: PendingPodcastPlaylistOperation["payload"];
};

const createOperationId = () =>
  `podcast-playlist-op:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

const episodeItems = (playlist: PlaylistSummary) =>
  playlist.items.filter((item) => item.mediaKind === "episode");

const episodeKeys = (playlist: PlaylistSummary) =>
  episodeItems(playlist).flatMap((item) => {
    const key = episodeIdentityKey(item);
    return key ? [key] : [];
  });

const dedupeEpisodeItems = (
  items: readonly EpisodePlaylistItemIdentity[],
): EpisodePlaylistItemIdentity[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = episodeIdentityKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export type ReplayedPodcastPlaylistState = {
  name: string;
  episodes: EpisodePlaylistItemIdentity[];
  deletePlaylist: boolean;
};

/** Apply local intents to the latest server state without losing unrelated server entries. */
export const replayPodcastPlaylistOperations = (
  server: Pick<PlaylistSummary, "name" | "items">,
  operations: readonly PendingPodcastPlaylistOperation[],
): ReplayedPodcastPlaylistState => {
  let name = server.name;
  let episodes = dedupeEpisodeItems(
    server.items
      .filter((item) => item.mediaKind === "episode")
      .map(({ libraryItemId, episodeId }) => ({ libraryItemId, episodeId })),
  );
  const explicitlyAdded = new Set<string>();
  let deletePlaylist = false;

  [...operations]
    .sort((left, right) => left.createdAt - right.createdAt)
    .forEach((operation) => {
      if (deletePlaylist) return;
      if (operation.type === "delete") {
        deletePlaylist = true;
        return;
      }
      if (operation.type === "rename" && operation.payload.name?.trim()) {
        name = operation.payload.name.trim();
        return;
      }

      const requested = dedupeEpisodeItems(operation.payload.episodes ?? []);
      if (operation.type === "addEpisodes") {
        const currentKeys = new Set(
          episodes.map((episode) => episodeIdentityKey(episode)),
        );
        requested.forEach((episode) => {
          const key = episodeIdentityKey(episode);
          if (!key) return;
          explicitlyAdded.add(key);
          if (!currentKeys.has(key)) {
            episodes.push(episode);
            currentKeys.add(key);
          }
        });
        return;
      }
      if (operation.type === "removeEpisodes") {
        const removed = new Set(
          requested.map((episode) => episodeIdentityKey(episode)),
        );
        episodes = episodes.filter(
          (episode) => !removed.has(episodeIdentityKey(episode)),
        );
        removed.forEach((key) => {
          if (key) explicitlyAdded.delete(key);
        });
        return;
      }
      if (operation.type === "setEpisodes") {
        const currentByKey = new Map(
          episodes.flatMap((episode) => {
            const key = episodeIdentityKey(episode);
            return key ? [[key, episode] as const] : [];
          }),
        );
        const requestedSurvivors = requested.filter((episode) => {
          const key = episodeIdentityKey(episode);
          return key ? currentByKey.has(key) || explicitlyAdded.has(key) : false;
        });
        const requestedKeys = new Set(
          requestedSurvivors.map((episode) => episodeIdentityKey(episode)),
        );
        episodes = [
          ...requestedSurvivors,
          ...episodes.filter(
            (episode) => !requestedKeys.has(episodeIdentityKey(episode)),
          ),
        ];
      }
    });

  return { name, episodes, deletePlaylist };
};

export const queuePodcastPlaylistOperation = (
  input: QueuePodcastPlaylistOperationInput,
  scope: PodcastShelfScope,
) => {
  const scopeKey = toPodcastShelfScopeKey(scope);
  if (!scopeKey || !input.shelfId || !input.absPlaylistId.trim()) return null;
  const operation: PendingPodcastPlaylistOperation = {
    ...input,
    absPlaylistId: input.absPlaylistId.trim(),
    scopeKey,
    userKey: scope.userKey.trim(),
    libraryId: scope.libraryId.trim(),
    id: createOperationId(),
    createdAt: Date.now(),
    attemptCount: 0,
    lastError: null,
    permanentFailure: false,
  };
  podcastShelvesStore.setState((state) => ({
    pendingPlaylistOperationsByScope: {
      ...state.pendingPlaylistOperationsByScope,
      [scopeKey]: [
        ...(state.pendingPlaylistOperationsByScope[scopeKey] ?? []),
        operation,
      ],
    },
    playlistShelvesByScope: {
      ...state.playlistShelvesByScope,
      [scopeKey]: (state.playlistShelvesByScope[scopeKey] ?? []).map((shelf) =>
        shelf.id === input.shelfId && shelf.syncState !== "missing"
          ? { ...shelf, syncState: "pending" as const }
          : shelf,
      ),
    },
  }));
  return operation.id;
};

/** Reconcile only after a successful complete library-playlists response. */
export const reconcilePodcastPlaylists = (
  playlists: readonly PlaylistSummary[],
  scope: PodcastShelfScope,
  now = Date.now(),
  completeResponse = true,
) => {
  const scopeKey = toPodcastShelfScopeKey(scope);
  if (!scopeKey) return;
  podcastShelvesStore.setState((state) => {
    const previous = state.playlistShelvesByScope[scopeKey] ?? [];
    const previousById = new Map(previous.map((shelf) => [shelf.id, shelf]));
    const pending = state.pendingPlaylistOperationsByScope[scopeKey] ?? [];
    const returnedIds = new Set<string>();
    const snapshots = { ...(state.episodeSnapshotsByScope[scopeKey] ?? {}) };
    const reconciled: PodcastPlaylistEpisodeShelf[] = [];

    playlists.forEach((playlist) => {
      const id = toPodcastPlaylistShelfId(playlist.id);
      if (!id) return;
      returnedIds.add(id);
      const existing = previousById.get(id);
      const hasPending = pending.some(
        (operation) =>
          operation.shelfId === id && !operation.permanentFailure,
      );
      episodeItems(playlist).forEach((item) => {
        if (!item.episode) return;
        const key = episodeIdentityKey(item);
        if (key) snapshots[key] = item.episode;
      });
      reconciled.push({
        kind: "playlistEpisode",
        id,
        absPlaylistId: playlist.id,
        name: hasPending && existing ? existing.name : playlist.name,
        description:
          hasPending && existing
            ? existing.description
            : playlist.description ?? null,
        episodeKeys:
          hasPending && existing ? existing.episodeKeys : episodeKeys(playlist),
        createdAt: existing?.createdAt ?? playlist.createdAt ?? now,
        updatedAt: now,
        serverUpdatedAt: playlist.updatedAt,
        lastServerSyncAt: now,
        missingOnServerAt: null,
        syncState: hasPending ? "pending" : "synced",
      });
      previousById.delete(id);
    });

    // Absence is authoritative only because this function receives a complete,
    // successful response. Retain the projection for recovery/status display.
    previousById.forEach((shelf) => {
      if (!completeResponse) {
        reconciled.push(shelf);
        return;
      }
      if (returnedIds.has(shelf.id)) return;
      reconciled.push({
        ...shelf,
        syncState: "missing",
        missingOnServerAt: shelf.missingOnServerAt ?? now,
        lastServerSyncAt: now,
      });
    });

    return {
      playlistShelvesByScope: {
        ...state.playlistShelvesByScope,
        [scopeKey]: reconciled,
      },
      episodeSnapshotsByScope: {
        ...state.episodeSnapshotsByScope,
        [scopeKey]: snapshots,
      },
    };
  });
};

const isMissingError = (error: unknown) =>
  error instanceof AbsApiError && error.status === 404;

const isTransientError = (error: unknown) =>
  error instanceof AbsOfflineError ||
  error instanceof AbsServerUnavailableError ||
  !(error instanceof AbsApiError) ||
  error.status == null ||
  error.status >= 500;

const finishOperations = (
  scopeKey: string,
  shelfId: string,
  processedIds: Set<string>,
  result: "synced" | "missing",
) => {
  podcastShelvesStore.setState((state) => {
    const remaining = (
      state.pendingPlaylistOperationsByScope[scopeKey] ?? []
    ).filter((operation) => !processedIds.has(operation.id));
    const stillPending = remaining.some(
      (operation) =>
        operation.shelfId === shelfId && !operation.permanentFailure,
    );
    return {
      pendingPlaylistOperationsByScope: {
        ...state.pendingPlaylistOperationsByScope,
        [scopeKey]: remaining,
      },
      playlistShelvesByScope: {
        ...state.playlistShelvesByScope,
        [scopeKey]: (state.playlistShelvesByScope[scopeKey] ?? []).map((shelf) =>
          shelf.id === shelfId
            ? {
                ...shelf,
                syncState:
                  result === "missing"
                    ? "missing"
                    : stillPending
                      ? "pending"
                      : "synced",
                missingOnServerAt:
                  result === "missing"
                    ? shelf.missingOnServerAt ?? Date.now()
                    : null,
              }
            : shelf,
        ),
      },
    };
  });
};

const failOperations = (
  scopeKey: string,
  shelfId: string,
  processedIds: Set<string>,
  error: unknown,
) => {
  const message = error instanceof Error ? error.message : "Playlist sync failed";
  const permanent = !isTransientError(error);
  podcastShelvesStore.setState((state) => ({
    pendingPlaylistOperationsByScope: {
      ...state.pendingPlaylistOperationsByScope,
      [scopeKey]: (
        state.pendingPlaylistOperationsByScope[scopeKey] ?? []
      ).map((operation) =>
        processedIds.has(operation.id)
          ? {
              ...operation,
              attemptCount: operation.attemptCount + 1,
              lastError: message,
              permanentFailure: permanent,
            }
          : operation,
      ),
    },
    playlistShelvesByScope: permanent
      ? {
          ...state.playlistShelvesByScope,
          [scopeKey]: (state.playlistShelvesByScope[scopeKey] ?? []).map(
            (shelf) =>
              shelf.id === shelfId
                ? { ...shelf, syncState: "unsynced" as const }
                : shelf,
          ),
        }
      : state.playlistShelvesByScope,
  }));
};

export const replayPendingPodcastPlaylistOperations = async (
  scope: PodcastShelfScope,
  transport: PodcastPlaylistTransport = playlistsApi,
) => {
  const scopeKey = toPodcastShelfScopeKey(scope);
  if (!scopeKey) return;
  const capturedQueue = [
    ...(podcastShelvesStore.getState().pendingPlaylistOperationsByScope[
      scopeKey
    ] ?? []),
  ].filter((operation) => !operation.permanentFailure);
  const shelfIds = [...new Set(capturedQueue.map((operation) => operation.shelfId))];

  for (const shelfId of shelfIds) {
    const operations = capturedQueue.filter(
      (operation) => operation.shelfId === shelfId,
    );
    if (!operations.length) continue;
    const processedIds = new Set(operations.map((operation) => operation.id));
    const absPlaylistId = operations[0]!.absPlaylistId;
    try {
      const latest = await transport.getPlaylist(absPlaylistId);
      if (!latest) {
        finishOperations(scopeKey, shelfId, processedIds, "missing");
        continue;
      }
      const desired = replayPodcastPlaylistOperations(latest, operations);
      if (desired.deletePlaylist) {
        await transport.deletePlaylist(absPlaylistId);
        finishOperations(scopeKey, shelfId, processedIds, "missing");
        continue;
      }
      let updated: PlaylistSummary | null = latest;
      if (desired.name !== latest.name) {
        updated = await transport.renamePlaylist(absPlaylistId, desired.name);
      }
      updated =
        (await transport.setEpisodePlaylistItems(
          absPlaylistId,
          desired.episodes,
        )) ?? updated;
      if (updated) reconcilePodcastPlaylists([updated], scope, Date.now(), false);
      finishOperations(scopeKey, shelfId, processedIds, "synced");
    } catch (error) {
      if (isMissingError(error)) {
        finishOperations(scopeKey, shelfId, processedIds, "missing");
      } else {
        failOperations(scopeKey, shelfId, processedIds, error);
      }
    }
  }
};
