import { meApi } from "@/api/me-api";
import { authStore } from "@/auth/auth-store";
import { setTouchedEpisodeContinueListeningHidden } from "@/data/sqlite/touched-episodes";
import {
  getBookDetailHref,
  type BookDetailRouteSource,
} from "@/navigation/book-links";
import {
  getEpisodeDetailHref,
  type EpisodeDetailRouteSource,
} from "@/navigation/episode-links";
import { playerService, usePlaybackStore } from "@/player";
import {
  resolveEpisodeActionSet,
  type EpisodeActionId,
  type ResolveEpisodeActionSetInput,
} from "@/podcast/episode-action-eligibility";
import type { EpisodeIdentity } from "@/podcast/episode-identity";
import type { TouchedEpisodeProgress } from "@/podcast/episode-continue-eligibility";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import {
  selectHasPlayableEpisodeDownloadForSession,
  useDeviceEpisodeDownloadsActions,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { router, useSegments } from "expo-router";
import { useMemo, useState } from "react";
import { toast } from "react-native-sonner";
import type { SFSymbols7_0 } from "sf-symbols-typescript";
import type { ResolvedEpisodeAction } from "./episode-action-menu";

export type EpisodeActionControllerProps = {
  identity: EpisodeIdentity;
  episodeTitle?: string | null;
  podcastTitle?: string | null;
  coverUri?: string | null;
  description?: string | null;
  publishedAt?: number | null;
  durationSeconds?: number | null;
  currentTimeSeconds?: number | null;
  mediaProgressId?: string | null;
  hideFromContinueListening?: boolean;
  actionIds: readonly EpisodeActionId[];
  isOnCurrentPodcast?: boolean;
};

const systemImageFor = (
  id: EpisodeActionId,
  isEpisodePlaying: boolean,
): SFSymbols7_0 => {
  switch (id) {
    case "playPause":
      return isEpisodePlaying ? "pause.fill" : "play.fill";
    case "download":
      return "arrow.down.circle";
    case "removeDownload":
      return "trash";
    case "removeFromContinueListening":
      return "eye.slash";
    case "openPodcast":
      return "mic.fill";
  }
};

const resolveRouteSource = (
  segments: readonly string[],
): EpisodeDetailRouteSource => {
  if (segments.some((segment) => segment === "search")) return "search";
  if (segments.some((segment) => segment === "library")) return "library";
  return "home";
};

export const useEpisodeActionController = ({
  identity,
  episodeTitle,
  podcastTitle,
  coverUri,
  description,
  publishedAt,
  durationSeconds,
  currentTimeSeconds,
  mediaProgressId,
  hideFromContinueListening = false,
  actionIds,
  isOnCurrentPodcast = false,
}: EpisodeActionControllerProps) => {
  const segments = useSegments();
  const routeSource = useMemo(() => resolveRouteSource(segments), [segments]);
  const bookRouteSource = routeSource as BookDetailRouteSource;
  const [busyAction, setBusyAction] = useState<EpisodeActionId | null>(null);
  const { downloadEpisode, deleteDownloadedEpisode } =
    useDeviceEpisodeDownloadsActions();
  const hasPlayableLocalDownload = useDeviceEpisodeDownloadsStore((state) =>
    selectHasPlayableEpisodeDownloadForSession(state, identity),
  );
  const playbackLibraryItemId = usePlaybackStore(
    (state) => state.libraryItemId,
  );
  const playbackEpisodeId = usePlaybackStore((state) => state.episodeId);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const isEpisodeLoaded =
    playbackLibraryItemId === identity.libraryItemId &&
    playbackEpisodeId === identity.episodeId;
  const isEpisodePlaying = isEpisodeLoaded && playbackState === "playing";

  const eligibilityInput: ResolveEpisodeActionSetInput = {
    actionIds,
    hasPlayableLocalDownload,
    isOnCurrentPodcast,
    isEpisodePlaying,
    canRemoveFromContinueListening: Boolean(
      mediaProgressId?.trim() && !hideFromContinueListening,
    ),
  };
  const eligibility = resolveEpisodeActionSet(eligibilityInput);

  const openEpisodeDetail = () => {
    router.push(
      getEpisodeDetailHref(identity, {
        episodeTitle,
        podcastTitle,
        coverUri,
        description,
        publishedAt,
        durationSeconds,
        currentTimeSeconds,
        routeSource,
      }),
    );
  };

  const openPodcast = () => {
    router.push(
      getBookDetailHref(identity.libraryItemId, {
        routeSource: bookRouteSource,
      }),
    );
  };

  const handlePlayPause = async () => {
    if (busyAction) return;
    setBusyAction("playPause");
    try {
      if (isEpisodePlaying) {
        await playerService.requestPause();
        return;
      }
      if (isEpisodeLoaded) {
        await playerService.requestPlay();
        return;
      }
      await playerService.requestStartEpisode(
        identity.libraryItemId,
        identity.episodeId,
        {
          episodeTitle: episodeTitle ?? undefined,
          podcastTitle: podcastTitle ?? undefined,
        },
      );
    } catch {
      toast.error(isEpisodePlaying ? "Unable to pause" : "Unable to play");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownload = async () => {
    if (busyAction) return;
    setBusyAction("download");
    try {
      await downloadEpisode(identity, {
        episodeTitle,
        podcastTitle,
        coverUri,
      });
    } catch (error) {
      toast.error("Download failed", {
        description:
          error instanceof Error
            ? error.message
            : "Unable to download this Episode.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveDownload = async () => {
    if (busyAction) return;
    setBusyAction("removeDownload");
    try {
      const playbackSnapshot =
        await playerService.prepareForDownloadedEpisodeDeletion(
          identity.libraryItemId,
          identity.episodeId,
        );
      await deleteDownloadedEpisode(identity);
      await playerService.resumeAfterDownloadedEpisodeDeletion(
        playbackSnapshot,
      );
    } catch {
      toast.error("Unable to remove download");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveFromContinueListening = async () => {
    if (busyAction) return;
    const progressId = mediaProgressId?.trim();
    const { activeLibraryUserKey: userId, activeLibraryId: libraryId } =
      authStore.getState();
    if (!progressId || !userId || !libraryId) {
      toast.error("Unable to remove from Continue Listening");
      return;
    }

    setBusyAction("removeFromContinueListening");
    const queryKey = queryKeys.podcastContinueEpisodes(userId, libraryId);
    const previous =
      queryClient.getQueryData<TouchedEpisodeProgress[]>(queryKey);
    queryClient.setQueryData<TouchedEpisodeProgress[]>(queryKey, (episodes) =>
      episodes?.map((episode) =>
        episode.libraryItemId === identity.libraryItemId &&
        episode.episodeId === identity.episodeId
          ? { ...episode, hideFromContinueListening: true }
          : episode,
      ),
    );

    try {
      await meApi.removeFromContinueListening(progressId);
      await setTouchedEpisodeContinueListeningHidden({
        userId,
        libraryId,
        libraryItemId: identity.libraryItemId,
        episodeId: identity.episodeId,
        mediaProgressId: progressId,
        hidden: true,
      });
      toast.success("Removed from Continue Listening");
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      toast.error("Unable to remove from Continue Listening", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const resolvedActions: ResolvedEpisodeAction[] = eligibility.map((action) => {
    const disabled = action.disabled || busyAction !== null;
    const base = {
      ...action,
      disabled,
      systemImage: systemImageFor(action.id, isEpisodePlaying),
    };
    switch (action.id) {
      case "playPause":
        return { ...base, onPress: handlePlayPause };
      case "download":
        return { ...base, onPress: handleDownload };
      case "removeDownload":
        return { ...base, onPress: handleRemoveDownload };
      case "removeFromContinueListening":
        return { ...base, onPress: handleRemoveFromContinueListening };
      case "openPodcast":
        return { ...base, onPress: openPodcast };
    }
  });

  return {
    resolvedActions,
    openEpisodeDetail,
    openPodcast,
    handlePlayPause,
    isEpisodePlaying,
    isEpisodeLoaded,
    hasPlayableLocalDownload,
    isBusy: busyAction !== null,
  };
};
