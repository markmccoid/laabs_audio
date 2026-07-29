import {
  selectEpisodeBookmark,
  useEpisodeBookmarksStore,
  useResolvedEpisodeListeningOwnerKey,
  type EpisodeBookmarkKind,
} from "@/podcast/episode-bookmarks-store";
import type { EpisodeIdentity } from "@/podcast/episode-identity";
import { usePlaybackStore } from "@/player";
import { MIN_CLIP_DURATION_SECONDS } from "@/components/bookComponents/clip-timing";
import { useLocalSearchParams } from "expo-router";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const resolveNumberParam = (value: string | string[] | undefined) => {
  const resolved = Number(resolveParam(value));
  return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
};

export type EpisodeBookmarkDraft = {
  identity: EpisodeIdentity;
  bookmarkId: string | null;
  episodeTitle: string;
  podcastTitle: string;
  durationSeconds: number;
  kind: EpisodeBookmarkKind;
  sourceBookmarkKind: EpisodeBookmarkKind | null;
  title: string;
  note: string;
  startTimeSeconds: number;
  endTimeSeconds: number | null;
  createdAt?: number;
  setTitle: (value: string) => void;
  setNote: (value: string) => void;
  setPointTime: (value: number) => void;
  setClipRange: (start: number, end: number) => void;
  removeClip: () => void;
};

const EpisodeBookmarkDraftContext = createContext<EpisodeBookmarkDraft | null>(null);

export const EpisodeBookmarkDraftProvider = ({ children }: { children: ReactNode }) => {
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    episodeId?: string | string[];
    bookmarkId?: string | string[];
    episodeTitle?: string | string[];
    podcastTitle?: string | string[];
    durationSeconds?: string | string[];
  }>();
  const libraryItemId = resolveParam(params.libraryItemId) ?? "";
  const episodeId = resolveParam(params.episodeId) ?? "";
  const identity = useMemo(() => ({ libraryItemId, episodeId }), [episodeId, libraryItemId]);
  const bookmarkId = resolveParam(params.bookmarkId) ?? null;
  const episodeTitle = resolveParam(params.episodeTitle) ?? "Episode";
  const podcastTitle = resolveParam(params.podcastTitle) ?? "Podcast";
  const ownerUserId = useResolvedEpisodeListeningOwnerKey(identity);
  const savedBookmark = useEpisodeBookmarksStore((state) =>
    selectEpisodeBookmark(state, ownerUserId, bookmarkId),
  );
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackEpisodeId = usePlaybackStore((state) => state.episodeId);
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);
  const isActiveEpisode =
    playbackLibraryItemId === identity.libraryItemId && playbackEpisodeId === identity.episodeId;
  const routeDurationSeconds = resolveNumberParam(params.durationSeconds);
  const durationSeconds = Math.max(
    MIN_CLIP_DURATION_SECONDS,
    Math.round(
      routeDurationSeconds || (isActiveEpisode ? playbackDurationMs / 1000 : 0) || 60 * 60,
    ),
  );
  const [draft, setDraft] = useState(() => ({
    kind: savedBookmark?.kind ?? ("point" as EpisodeBookmarkKind),
    title: savedBookmark?.title ?? "",
    note: savedBookmark?.note ?? "",
    startTimeSeconds:
      savedBookmark?.startTimeSeconds ??
      (isActiveEpisode ? Math.max(0, Math.round(playbackPositionMs / 1000)) : 0),
    endTimeSeconds:
      savedBookmark?.kind === "clip" ? (savedBookmark.endTimeSeconds ?? null) : null,
    createdAt: savedBookmark?.createdAt,
  }));

  const value = useMemo<EpisodeBookmarkDraft>(
    () => ({
      identity,
      bookmarkId,
      episodeTitle,
      podcastTitle,
      durationSeconds,
      ...draft,
      sourceBookmarkKind: savedBookmark?.kind ?? null,
      setTitle: (title) => setDraft((current) => ({ ...current, title })),
      setNote: (note) => setDraft((current) => ({ ...current, note })),
      setPointTime: (startTimeSeconds) =>
        setDraft((current) => ({
          ...current,
          startTimeSeconds: Math.max(0, Math.min(durationSeconds, Math.round(startTimeSeconds))),
          ...(current.kind === "point" ? { endTimeSeconds: null } : {}),
        })),
      setClipRange: (startTimeSeconds, endTimeSeconds) =>
        setDraft((current) => ({
          ...current,
          kind: "clip",
          startTimeSeconds: Math.max(0, Math.round(startTimeSeconds)),
          endTimeSeconds: Math.min(durationSeconds, Math.round(endTimeSeconds)),
        })),
      removeClip: () =>
        setDraft((current) => ({ ...current, kind: "point", endTimeSeconds: null })),
    }),
    [bookmarkId, draft, durationSeconds, episodeTitle, identity, podcastTitle, savedBookmark?.kind],
  );

  return (
    <EpisodeBookmarkDraftContext.Provider value={value}>
      {children}
    </EpisodeBookmarkDraftContext.Provider>
  );
};

export const useEpisodeBookmarkDraft = () => {
  const value = useContext(EpisodeBookmarkDraftContext);
  if (!value) {
    throw new Error("useEpisodeBookmarkDraft requires EpisodeBookmarkDraftProvider");
  }
  return value;
};
