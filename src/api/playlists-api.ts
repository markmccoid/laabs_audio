import { authStore } from "../auth/auth-store";
import { absClient } from "./abs-client";

export type PlaylistItemRef = {
  libraryItemId: string;
};

export type PlaylistSummary = {
  id: string;
  libraryId: string;
  name: string;
  description: string | null;
  items: PlaylistItemRef[];
  createdAt: number | null;
  updatedAt: number | null;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

const asString = (value: unknown) => (typeof value === "string" ? value : null);
const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

const toPlaylistItemRef = (value: unknown): PlaylistItemRef | null => {
  const record = asRecord(value);
  if (!record) return null;

  const directId = asString(record.libraryItemId);
  if (directId) return { libraryItemId: directId };

  const nestedLibraryItem = asRecord(record.libraryItem);
  const nestedId = asString(nestedLibraryItem?.id);
  if (nestedId) return { libraryItemId: nestedId };

  return null;
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
  const createdAt = asNumber(record.createdAt);
  const updatedAt = asNumber(record.updatedAt) ?? asNumber(record.lastUpdate);
  const items = toPlaylistItems(record.items);

  return {
    id,
    libraryId,
    name,
    description,
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

const resolveLibraryId = (libraryId?: string | null) =>
  libraryId ?? authStore.getState().activeLibraryId;

const buildPlaylistItemPayload = (libraryItemIds: string[]) =>
  libraryItemIds.map((libraryItemId) => ({ libraryItemId }));

export const playlistsApi = {
  async getLibraryPlaylists(libraryId?: string | null): Promise<PlaylistSummary[]> {
    const libraryIdToUse = resolveLibraryId(libraryId);
    if (!libraryIdToUse || !libraryIdToUse.trim()) return [];

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
      items: buildPlaylistItemPayload(payload.items ?? []),
    });
    const [playlist] = extractPlaylists(created);
    return playlist ?? null;
  },

  async renamePlaylist(playlistId: string, name: string): Promise<PlaylistSummary | null> {
    const payload = await absClient.patch<unknown>(`/api/playlists/${playlistId}`, { name });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async setPlaylistItems(
    playlistId: string,
    orderedLibraryItemIds: string[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.patch<unknown>(`/api/playlists/${playlistId}`, {
      items: buildPlaylistItemPayload(orderedLibraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async batchAddItems(
    playlistId: string,
    libraryItemIds: string[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.post<unknown>(`/api/playlists/${playlistId}/batch/add`, {
      items: buildPlaylistItemPayload(libraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async batchRemoveItems(
    playlistId: string,
    libraryItemIds: string[],
  ): Promise<PlaylistSummary | null> {
    const payload = await absClient.post<unknown>(`/api/playlists/${playlistId}/batch/remove`, {
      items: buildPlaylistItemPayload(libraryItemIds),
    });
    const [playlist] = extractPlaylists(payload);
    return playlist ?? null;
  },

  async deletePlaylist(playlistId: string): Promise<void> {
    await absClient.delete<void>(`/api/playlists/${playlistId}`);
  },
};
