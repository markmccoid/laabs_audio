import { playlistsApi } from "@/api/playlists-api";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { useAuthStore } from "@/auth/auth-store";
import { usePlaybackStore } from "@/player/playback-store";
import { assembleDownloadedEpisodesShelf } from "@/podcast/episode-download-facade";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import {
  assemblePodcastHomeShelves,
  orderPodcastEpisodesByStoredKeys,
} from "@/podcast/podcast-home-shelves";
import {
  reconcilePodcastPlaylists,
} from "@/podcast/podcast-playlist-sync";
import type { PodcastShelfEpisodeItem } from "@/podcast/podcast-shelf-types";
import {
  applyActiveEpisodePlaybackOverlay,
  promoteActiveEpisodeInContinueShelf,
  toContinueShelfItemFromRecent,
} from "@/podcast/recent-episodes-shelf";
import {
  usePodcastContinueEpisodes,
  usePodcastRecentEpisodes,
  usePodcastSeriesByAddedAt,
  usePodcastTouchedEpisodes,
} from "@/podcast/use-podcast-series";
import { queryKeys } from "@/query/query-keys";
import {
  listEpisodeDownloadedAssetRecords,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import {
  selectPodcastDeviceShelves,
  selectPodcastPlaylistShelves,
  selectPodcastShelfSnapshots,
  selectSuppressedPodcastPlaylistIds,
  toPodcastShelfScopeKey,
  usePodcastShelvesStore,
} from "@/store/podcast-shelves-store";
import { useSettingsStore } from "@/store/settings-store";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

const EMPTY_SETTINGS = {};
const EMPTY_ORDER: string[] = [];

export const usePodcastHomeShelves = () => {
  const experience = useActiveLibraryExperience();
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const isOnline = useAuthStore((state) => state.isOnline);
  const scope = useMemo(
    () =>
      activeLibraryId && activeLibraryUserKey
        ? { userKey: activeLibraryUserKey, libraryId: activeLibraryId }
        : null,
    [activeLibraryId, activeLibraryUserKey],
  );
  const scopeKey = scope ? toPodcastShelfScopeKey(scope) : null;

  const seriesQuery = usePodcastSeriesByAddedAt();
  const continueQuery = usePodcastContinueEpisodes();
  const touchedQuery = usePodcastTouchedEpisodes();
  const recentQuery = usePodcastRecentEpisodes();
  const playlistQuery = useQuery({
    queryKey: queryKeys.libraryPlaylists(
      activeLibraryUserKey,
      activeLibraryId,
    ),
    queryFn: () => playlistsApi.getLibraryPlaylists(activeLibraryId!),
    enabled:
      status === "authenticated" &&
      experience === "podcast" &&
      Boolean(scope) &&
      isOnline !== false,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!scope || !playlistQuery.isSuccess || !playlistQuery.data) return;
    reconcilePodcastPlaylists(playlistQuery.data, scope);
  }, [playlistQuery.data, playlistQuery.isSuccess, scope]);

  const deviceShelves = usePodcastShelvesStore((state) =>
    selectPodcastDeviceShelves(state, scopeKey),
  );
  const playlistShelves = usePodcastShelvesStore((state) =>
    selectPodcastPlaylistShelves(state, scopeKey),
  );
  const snapshotsByKey = usePodcastShelvesStore((state) =>
    selectPodcastShelfSnapshots(state, scopeKey),
  );
  const suppressedPlaylistIds = usePodcastShelvesStore((state) =>
    selectSuppressedPodcastPlaylistIds(state, scopeKey),
  );
  const downloadedEpisodeOrder = usePodcastShelvesStore((state) =>
    scopeKey
      ? state.downloadedEpisodeOrderByScope[scopeKey] ?? EMPTY_ORDER
      : EMPTY_ORDER,
  );
  const reconcileDownloadedEpisodeOrder = usePodcastShelvesStore(
    (state) => state.actions.reconcileDownloadedEpisodeOrder,
  );
  const shelfSettingsById = useSettingsStore((state) =>
    scopeKey
      ? state.homeShelvesByScope[scopeKey]?.shelfSettingsById ?? EMPTY_SETTINGS
      : EMPTY_SETTINGS,
  );
  const shelfOrder = useSettingsStore((state) =>
    scopeKey
      ? state.homeShelvesByScope[scopeKey]?.shelfOrder ?? EMPTY_ORDER
      : EMPTY_ORDER,
  );

  const playbackLibraryItemId = usePlaybackStore(
    (state) => state.libraryItemId,
  );
  const playbackEpisodeId = usePlaybackStore((state) => state.episodeId);
  const playbackTitle = usePlaybackStore((state) => state.bookTitle);
  const playbackPodcastTitle = usePlaybackStore(
    (state) => state.secondaryTitle,
  );
  const playbackCover = usePlaybackStore(
    (state) => state.queue[0]?.artworkUri ?? null,
  );
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);
  const activePlayback = useMemo(
    () =>
      playbackLibraryItemId && playbackEpisodeId
        ? {
            libraryItemId: playbackLibraryItemId,
            episodeId: playbackEpisodeId,
            currentTimeSeconds: Math.max(0, playbackPositionMs / 1000),
            durationSeconds: Math.max(0, playbackDurationMs / 1000),
          }
        : null,
    [
      playbackDurationMs,
      playbackEpisodeId,
      playbackLibraryItemId,
      playbackPositionMs,
    ],
  );

  const downloadedEpisodeDetailsById = useDeviceEpisodeDownloadsStore(
    (state) => state.downloadedEpisodeDetailsById,
  );
  const downloadedEpisodeData = useDeviceEpisodeDownloadsStore(
    (state) => state.downloadedEpisodeData,
  );
  const downloadedEpisodeOwnerUserIdsById = useDeviceEpisodeDownloadsStore(
    (state) => state.downloadedEpisodeOwnerUserIdsById,
  );

  const touchedByKey = useMemo(
    () =>
      new Map(
        (touchedQuery.data ?? []).flatMap((episode) => {
          const key = episodeIdentityKey(episode);
          return key ? [[key, episode] as const] : [];
        }),
      ),
    [touchedQuery.data],
  );

  const downloadedEpisodes = useMemo(() => {
    const records = listEpisodeDownloadedAssetRecords({
      downloadedEpisodeDetailsById,
      downloadedEpisodeData,
      downloadedEpisodeOwnerUserIdsById,
    });
    const assembled = assembleDownloadedEpisodesShelf(records, {
      activeLibraryId,
      sessionUserId: activeLibraryUserKey,
    }).map((episode): PodcastShelfEpisodeItem => {
      const key = episodeIdentityKey(episode) ?? "";
      const touched = touchedByKey.get(key);
      return {
        mediaProgressId: touched?.mediaProgressId ?? null,
        libraryItemId: episode.libraryItemId,
        episodeId: episode.episodeId,
        title: episode.title,
        podcastTitle: episode.podcastTitle,
        cover: episode.cover,
        coverFull: episode.cover,
        durationSeconds: Math.max(
          episode.durationSeconds,
          touched?.durationSeconds ?? 0,
        ),
        publishedAt: null,
        currentTimeSeconds: touched?.currentTimeSeconds ?? 0,
        isFinished: touched?.isFinished ?? false,
        hideFromContinueListening:
          touched?.hideFromContinueListening ?? false,
        lastUpdate: Math.max(
          episode.downloadedAt,
          touched?.lastUpdate ?? 0,
        ),
        isDownloaded: true,
      };
    });
    return orderPodcastEpisodesByStoredKeys(assembled, downloadedEpisodeOrder);
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    downloadedEpisodeData,
    downloadedEpisodeDetailsById,
    downloadedEpisodeOrder,
    downloadedEpisodeOwnerUserIdsById,
    touchedByKey,
  ]);

  const downloadedKeys = useMemo(
    () =>
      new Set(
        downloadedEpisodes.flatMap((episode) => {
          const key = episodeIdentityKey(episode);
          return key ? [key] : [];
        }),
      ),
    [downloadedEpisodes],
  );

  useEffect(() => {
    if (!scope) return;
    reconcileDownloadedEpisodeOrder(downloadedEpisodes, scope);
  }, [downloadedEpisodes, reconcileDownloadedEpisodeOrder, scope]);

  const continueEpisodes = useMemo(() => {
    const promoted = promoteActiveEpisodeInContinueShelf(
      continueQuery.data ?? [],
      activePlayback
        ? {
            ...activePlayback,
            title: playbackTitle,
            podcastTitle: playbackPodcastTitle,
            cover: playbackCover,
          }
        : null,
    );
    return promoted.map(
      (episode): PodcastShelfEpisodeItem => ({
        mediaProgressId: episode.mediaProgressId,
        libraryItemId: episode.libraryItemId,
        episodeId: episode.episodeId,
        title: episode.title,
        podcastTitle: episode.podcastTitle,
        cover: episode.cover,
        coverFull: episode.cover,
        durationSeconds: episode.durationSeconds,
        publishedAt: null,
        currentTimeSeconds: episode.currentTimeSeconds,
        isFinished: episode.isFinished,
        hideFromContinueListening: episode.hideFromContinueListening,
        lastUpdate: episode.lastUpdate,
        isDownloaded: downloadedKeys.has(episodeIdentityKey(episode) ?? ""),
      }),
    );
  }, [
    activePlayback,
    continueQuery.data,
    downloadedKeys,
    playbackCover,
    playbackPodcastTitle,
    playbackTitle,
  ]);

  const recentEpisodes = useMemo(() => {
    const overlaid = applyActiveEpisodePlaybackOverlay(
      recentQuery.data ?? [],
      activePlayback,
    );
    return overlaid.map((episode): PodcastShelfEpisodeItem => {
      const projected = toContinueShelfItemFromRecent(episode);
      const key = episodeIdentityKey(projected) ?? "";
      const touched = touchedByKey.get(key);
      return {
        mediaProgressId: touched?.mediaProgressId ?? episode.mediaProgressId,
        libraryItemId: episode.libraryItemId,
        episodeId: episode.episodeId,
        title: episode.title,
        podcastTitle: episode.podcastTitle,
        cover: episode.cover,
        coverFull: episode.cover,
        durationSeconds: Math.max(
          episode.durationSeconds,
          touched?.durationSeconds ?? 0,
        ),
        publishedAt: episode.publishedAt,
        currentTimeSeconds: Math.max(
          episode.currentTimeSeconds,
          touched?.currentTimeSeconds ?? 0,
        ),
        isFinished: touched?.isFinished ?? false,
        hideFromContinueListening:
          touched?.hideFromContinueListening ??
          episode.hideFromContinueListening,
        lastUpdate: touched?.lastUpdate ?? episode.publishedAt ?? 0,
        isDownloaded: downloadedKeys.has(key),
      };
    });
  }, [activePlayback, downloadedKeys, recentQuery.data, touchedByKey]);

  const overlaysByKey = useMemo(
    () =>
      Object.fromEntries(
        (touchedQuery.data ?? []).flatMap((episode) => {
          const key = episodeIdentityKey(episode);
          return key
            ? [
                [
                  key,
                  {
                    currentTimeSeconds: episode.currentTimeSeconds,
                    isFinished: episode.isFinished,
                    hideFromContinueListening:
                      episode.hideFromContinueListening,
                    lastUpdate: episode.lastUpdate,
                    isDownloaded: downloadedKeys.has(key),
                  },
                ] as const,
              ]
            : [];
        }),
      ),
    [downloadedKeys, touchedQuery.data],
  );

  const shelves = useMemo(
    () =>
      assemblePodcastHomeShelves({
        continueEpisodes,
        recentEpisodes,
        podcasts: seriesQuery.data ?? [],
        downloadedEpisodes,
        deviceShelves,
        playlistShelves,
        snapshotsByKey,
        overlaysByKey,
        suppressedPlaylistIds,
        shelfSettingsById,
        shelfOrder,
      }),
    [
      continueEpisodes,
      deviceShelves,
      downloadedEpisodes,
      overlaysByKey,
      playlistShelves,
      recentEpisodes,
      seriesQuery.data,
      shelfOrder,
      shelfSettingsById,
      snapshotsByKey,
      suppressedPlaylistIds,
    ],
  );

  return {
    ...shelves,
    scope,
    scopeKey,
    playlistQuery,
    isLoading:
      continueQuery.isLoading ||
      recentQuery.isLoading ||
      seriesQuery.isLoading,
  };
};
