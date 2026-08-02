import { absClient } from "./abs-client";
import { buildCoverUrls } from "./cover-urls";
import type { PodcastShelfEpisodeSnapshot } from "../podcast/podcast-shelf-types";

export type BookPlaylistItemRef = {
  mediaKind: "book";
  libraryItemId: string;
};

export type EpisodePlaylistItemRef = {
  mediaKind: "episode";
  libraryItemId: string;
  episodeId: string;
  episode: PodcastShelfEpisodeSnapshot | null;
};

export type PlaylistItemRef = BookPlaylistItemRef | EpisodePlaylistItemRef;

export type EpisodePlaylistItemIdentity = {
  libraryItemId: string;
  episodeId: string;
};

export type PlaylistSummary = {
  id: string;
  libraryId: string;
  name: string;
  description: string | null;
  coverPath: string | null;
  items: PlaylistItemRef[];
  createdAt: number | null;
  updatedAt: number | null;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

const asString = (value: unknown) => (typeof value === "string" ? value : null);
const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

const asTrimmedString = (value: unknown) => asString(value)?.trim() || null;

const toEpisodeSnapshot = (
  libraryItemId: string,
  episodeId: string,
  record: UnknownRecord,
): PodcastShelfEpisodeSnapshot | null => {
  const episode = asRecord(record.episode);
  if (!episode) return null;

  const nestedEpisodeId = asTrimmedString(episode.id);
  const nestedLibraryItemId = asTrimmedString(episode.libraryItemId);
  if (
    (nestedEpisodeId && nestedEpisodeId !== episodeId) ||
    (nestedLibraryItemId && nestedLibraryItemId !== libraryItemId)
  ) {
    return null;
  }

  const libraryItem = asRecord(record.libraryItem);
  const media = asRecord(libraryItem?.media);
  const metadata = asRecord(media?.metadata);
  const episodePodcast = asRecord(episode.podcast);
  const episodePodcastMetadata = asRecord(episodePodcast?.metadata);
  const publishedAt = asNumber(episode.publishedAt);
  const updatedAt = asNumber(libraryItem?.updatedAt);

  let cover: string | null = null;
  let coverFull: string | null = null;
  try {
    const covers = buildCoverUrls(libraryItemId, {
      version: updatedAt ?? publishedAt,
    });
    cover = covers.thumb;
    coverFull = covers.full;
  } catch {
    // A parsed playlist remains useful before a server endpoint is restored.
  }

  return {
    libraryItemId,
    episodeId,
    title: asTrimmedString(episode.title) ?? "Episode",
    podcastTitle:
      asTrimmedString(metadata?.title) ??
      asTrimmedString(episodePodcastMetadata?.title) ??
      "Podcast",
    cover,
    coverFull,
    durationSeconds: Math.max(
      0,
      asNumber(episode.duration) ??
        asNumber(asRecord(episode.audioFile)?.duration) ??
        0,
    ),
    publishedAt,
  };
};

const toPlaylistItemRef = (value: unknown): PlaylistItemRef | null => {
  const record = asRecord(value);
  if (!record) return null;

  const nestedLibraryItem = asRecord(record.libraryItem);
  const libraryItemId =
    asTrimmedString(record.libraryItemId) ?? asTrimmedString(nestedLibraryItem?.id);
  if (!libraryItemId) return null;

  const episodeId = asTrimmedString(record.episodeId);
  if (episodeId) {
    return {
      mediaKind: "episode",
      libraryItemId,
      episodeId,
      episode: toEpisodeSnapshot(libraryItemId, episodeId, record),
    };
  }

  // A Podcast playlist entry without an Episode ID is malformed and must not
  // become a playable book-shaped entry.
  if (asTrimmedString(nestedLibraryItem?.mediaType) === "podcast") return null;

  return { mediaKind: "book", libraryItemId };
};

const toPlaylistItems = (value: unknown): PlaylistItemRef[] => {
  if (!Array.isArray(value)) return [];

  const items: PlaylistItemRef[] = [];
  value.forEach((candidate) => {
    const item = toPlaylistItemRef(candidate);
    if (!item) return;
    items.push(item);
  });
  return items;
};

const normalizePlaylist = (value: unknown): PlaylistSummary | null => {
  const record = asRecord(value);
  if (!record) return null;

  const id = asString(record.id);
  if (!id) return null;

  const libraryId = asString(record.libraryId) ?? "";
  const name = asString(record.name) ?? "Untitled Playlist";
  const description = asString(record.description);
  const coverPath = asString(record.coverPath);
  const createdAt = asNumber(record.createdAt);
  const updatedAt = asNumber(record.updatedAt) ?? asNumber(record.lastUpdate);
  const items = toPlaylistItems(record.items);

  return {
    id,
    libraryId,
    name,
    description,
    coverPath,
    items,
    createdAt,
    updatedAt,
  };
};

const extractPlaylists = (payload: unknown): PlaylistSummary[] => {
  if (Array.isArray(payload)) {
    return payload.map(normalizePlaylist).filter((value): value is PlaylistSummary => Boolean(value));
  }

  const record = asRecord(payload);
  if (!record) return [];

  const results = Array.isArray(record.results) ? record.results : null;
  if (results) {
    return results
      .map(normalizePlaylist)
      .filter((value): value is PlaylistSummary => Boolean(value));
  }

  const playlists = Array.isArray(record.playlists) ? record.playlists : null;
  if (playlists) {
    return playlists
      .map(normalizePlaylist)
      .filter((value): value is PlaylistSummary => Boolean(value));
  }

  const single = normalizePlaylist(record);
  return single ? [single] : [];
};

const requireLibraryId = (libraryId: string, requestName: string) => {
  const trimmed = libraryId.trim();
  if (!trimmed) {
    throw new Error(`${requestName} requires a libraryId`);
  }
  return trimmed;
};

const buildBookPlaylistItemPayload = (libraryItemIds: readonly string[]) =>
  libraryItemIds.map((libraryItemId) => ({ libraryItemId }));

const buildEpisodePlaylistItemPayload = (
  items: readonly EpisodePlaylistItemIdentity[],
) => items.map(({ libraryItemId, episodeId }) => ({ libraryItemId, episodeId }));

export const playlistsApi = {
  async getLibraryPlaylists(libraryId: string): Promise<PlaylistSummary[]> {
    const libraryIdToUse = requireLibraryId(libraryId, "playlistsApi.getLibraryPlaylists");

    const payload = await absClient.get<unknown>(`/api/libraries/${libraryIdToUse}/playlists`);
    return extractPlaylists(payload).map((playlist) => ({
      ...playlist,
      libraryId: playlist.libraryId || libraryIdToUse,
    }));
  },

  async getPlaylist(playlistId: string): Promise<PlaylistSummary | null> {
    if (!playlistId.trim()) return null;
    const payload = await absClient.get<unknown>(`/api/playlists/${playlistId}`);
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async createPlaylist(payload: {
    libraryId: string;
    name: string;
    description?: string | null;
    items?: string[];
  }): Promise<PlaylistSummary | null> {
    const created = await absClient.post<unknown>("/api/playlists", {
      libraryId: payload.libraryId,
      name: payload.name,
      description: payload.description ?? undefined,
      items: buildBookPlaylistItemPayload(payload.items ?? []),
    });
    const [playlist] = extractPlaylists(created);
    return playlist ?? null;
  },

  async renamePlaylist(playlistId: string, name: string): Promise<PlaylistSummary | null> {
    const payload = await absClient.patch<unknown>(`/api/playlists/${playlistId}`, { name });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async updatePlaylist(
    playlistId: string,
    updates: { name?: string; orderedLibraryItemIds?: string[] },
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.patch<unknown>(`/api/playlists/${playlistId}`, {
      name: updates.name,
      items:
        updates.orderedLibraryItemIds === undefined
          ? undefined
          : buildBookPlaylistItemPayload(updates.orderedLibraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async setPlaylistItems(
    playlistId: string,
    orderedLibraryItemIds: string[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.patch<unknown>(`/api/playlists/${playlistId}`, {
      items: buildBookPlaylistItemPayload(orderedLibraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async batchAddItems(
    playlistId: string,
    libraryItemIds: string[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.post<unknown>(`/api/playlists/${playlistId}/batch/add`, {
      items: buildBookPlaylistItemPayload(libraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async batchRemoveItems(
    playlistId: string,
    libraryItemIds: string[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.post<unknown>(`/api/playlists/${playlistId}/batch/remove`, {
      items: buildBookPlaylistItemPayload(libraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async createEpisodePlaylist(payload: {
    libraryId: string;
    name: string;
    description?: string | null;
    items?: EpisodePlaylistItemIdentity[];
  }): Promise<PlaylistSummary | null> {
    const created = await absClient.post<unknown>("/api/playlists", {
      libraryId: payload.libraryId,
      name: payload.name,
      description: payload.description ?? undefined,
      items: buildEpisodePlaylistItemPayload(payload.items ?? []),
    });
    const [playlist] = extractPlaylists(created);
    return playlist ?? null;
  },

  async setEpisodePlaylistItems(
    playlistId: string,
    orderedItems: EpisodePlaylistItemIdentity[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.patch<unknown>(`/api/playlists/${playlistId}`, {
      items: buildEpisodePlaylistItemPayload(orderedItems),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async batchAddEpisodes(
    playlistId: string,
    items: EpisodePlaylistItemIdentity[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.post<unknown>(`/api/playlists/${playlistId}/batch/add`, {
      items: buildEpisodePlaylistItemPayload(items),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async batchRemoveEpisodes(
    playlistId: string,
    items: EpisodePlaylistItemIdentity[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.post<unknown>(`/api/playlists/${playlistId}/batch/remove`, {
      items: buildEpisodePlaylistItemPayload(items),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async deletePlaylist(playlistId: string): Promise<void> {
    await absClient.delete<void>(`/api/playlists/${playlistId}`);
  },
};
