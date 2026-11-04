import type { EpisodeBookmarkRecord } from "@/podcast/episode-bookmarks-store";
import type { LocalBookmarkRecord } from "@/store/device-books-store";
import type { SidecarBookmarkRecord, SidecarEpisodeRef } from "./sidecar-format";
import { recordContentHash } from "./sidecar-merge";

export type SyncedRecordState = { hash: string; updatedAt: number };

/**
 * Local bookkeeping (ADR 0001 server-link updates) bumps `updatedAt` without
 * changing anything the user sees. Keep the last-synced `updatedAt` for
 * unchanged content so that bookkeeping never beats a real edit elsewhere.
 */
const withEffectiveUpdatedAt = (
  record: SidecarBookmarkRecord,
  synced: SyncedRecordState | undefined,
): SidecarBookmarkRecord =>
  synced && synced.hash === recordContentHash(record)
    ? { ...record, updatedAt: synced.updatedAt }
    : record;

const clipEnd = (kind: "point" | "clip", endTimeSeconds: number | null | undefined) =>
  kind === "clip" && typeof endTimeSeconds === "number" ? { endTimeSeconds } : {};

export const bookRecordToSidecar = (
  record: LocalBookmarkRecord,
  synced?: SyncedRecordState,
): SidecarBookmarkRecord =>
  withEffectiveUpdatedAt(
    {
      id: record.id,
      kind: record.kind,
      startTimeSeconds: record.startTimeSeconds,
      ...clipEnd(record.kind, record.endTimeSeconds),
      title: record.title,
      note: record.note ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: null,
    },
    synced,
  );

/**
 * A record arriving from a Bookmark Sidecar keeps its server link when its
 * start is unchanged; otherwise it arrives Unmatched and ADR 0001
 * reconciliation matches or recreates its Server Bookmark.
 */
export const sidecarToBookRecord = (
  record: SidecarBookmarkRecord,
  libraryItemId: string,
  existing: LocalBookmarkRecord | null | undefined,
): LocalBookmarkRecord => ({
  id: record.id,
  libraryItemId,
  kind: record.kind,
  startTimeSeconds: record.startTimeSeconds,
  ...clipEnd(record.kind, record.endTimeSeconds),
  title: record.title,
  note: record.note ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  serverLink:
    existing && existing.startTimeSeconds === record.startTimeSeconds
      ? existing.serverLink
      : { status: "unmatched", timeSeconds: record.startTimeSeconds, lastMatchedAt: null },
});

export const episodeRecordToSidecar = (
  record: EpisodeBookmarkRecord,
  episode: SidecarEpisodeRef,
  synced?: SyncedRecordState,
): SidecarBookmarkRecord =>
  withEffectiveUpdatedAt(
    {
      id: record.id,
      kind: record.kind,
      startTimeSeconds: record.startTimeSeconds,
      ...clipEnd(record.kind, record.endTimeSeconds),
      title: record.title,
      note: record.note ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: null,
      episode,
    },
    synced,
  );

export const sidecarToEpisodeRecord = (
  record: SidecarBookmarkRecord,
  userId: string,
  libraryItemId: string,
  episodeId: string,
): EpisodeBookmarkRecord => ({
  id: record.id,
  userId,
  identity: { libraryItemId, episodeId },
  kind: record.kind,
  startTimeSeconds: record.startTimeSeconds,
  ...clipEnd(record.kind, record.endTimeSeconds),
  title: record.title,
  note: record.note ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  serverStatus: "unsupported",
});

/**
 * Episode ids regenerate on an Audiobookshelf rebuild, so the audio file's path
 * inside the Podcast folder is tried first (ADR 0046).
 */
export const resolveSidecarEpisodeId = (
  ref: SidecarEpisodeRef | null | undefined,
  currentEpisodes: readonly SidecarEpisodeRef[],
): string | null => {
  if (!ref) return null;
  if (ref.audioRelPath) {
    const byPath = currentEpisodes.find((episode) => episode.audioRelPath === ref.audioRelPath);
    if (byPath) return byPath.episodeId;
  }
  return currentEpisodes.find((episode) => episode.episodeId === ref.episodeId)?.episodeId ?? null;
};
