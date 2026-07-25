import { useAuthStore } from "@/auth/auth-store";
import { canUseAudiobookshelfServer } from "@/auth/server-connection";
import PlayPauseAnimation, {
  type PlaybackControlVisualState,
} from "@/components/bookComponents/play-pause-animation";
import type { EpisodeIdentity } from "@/podcast/episode-identity";
import { isStreamedPlaybackStartFailure, playerService, usePlaybackStore } from "@/player";
import {
  selectHasPlayableEpisodeDownloadForSession,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { toast } from "react-native-sonner";

type Props = {
  identity: EpisodeIdentity;
  episodeTitle?: string | null;
  podcastTitle?: string | null;
};

const showStreamedPlaybackStartFailureToast = () => {
  toast.error("Unable to start streaming", {
    description:
      "Your connection is not good enough for streaming right now. Try again when it improves, or download the episode.",
  });
};

export const EpisodeControls = ({ identity, episodeTitle, podcastTitle }: Props) => {
  const themeColors = useThemeColors();
  const isOnline = useAuthStore((state) => state.isOnline);
  const serverConnectionStatus = useAuthStore((state) => state.serverConnectionStatus);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playbackControlIntent = usePlaybackStore((state) => state.playbackControlIntent);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const currentEpisodeId = usePlaybackStore((state) => state.episodeId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const hasPlayableLocalDownload = useDeviceEpisodeDownloadsStore((state) =>
    selectHasPlayableEpisodeDownloadForSession(state, identity),
  );
  const canUseServer = canUseAudiobookshelfServer({ isOnline, serverConnectionStatus });
  const [pendingLoadKey, setPendingLoadKey] = useState<string | null>(null);

  const episodeKey = `${identity.libraryItemId}:${identity.episodeId}`;
  const hasIdentity = Boolean(identity.libraryItemId && identity.episodeId);
  const isEpisodeActive =
    hasIdentity &&
    currentLibraryItemId === identity.libraryItemId &&
    currentEpisodeId === identity.episodeId;
  const isEpisodeLoaded = isEpisodeActive && queueLength > 0;
  const isPendingForViewedEpisode = pendingLoadKey === episodeKey;
  const hasActivePlaybackControlIntent = playbackControlIntent !== null;
  const isStartIntentForViewedEpisode =
    playbackControlIntent?.kind === "start" &&
    playbackControlIntent.libraryItemId === identity.libraryItemId &&
    playbackControlIntent.episodeId === identity.episodeId;

  useEffect(() => {
    if (pendingLoadKey !== episodeKey) return;

    const isLoadedForViewedEpisode = isEpisodeActive && isEpisodeLoaded;
    const canResolvePending =
      isLoadedForViewedEpisode || playbackState === "error" || playbackState === "ended";

    if (!canResolvePending) return;

    const timeoutId = setTimeout(() => {
      setPendingLoadKey(null);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [episodeKey, pendingLoadKey, playbackState, isEpisodeActive, isEpisodeLoaded]);

  const viewedEpisodeState: PlaybackControlVisualState = (() => {
    if (!hasIdentity) return "not-loaded";
    if (isStartIntentForViewedEpisode) return "loading";
    if (isPendingForViewedEpisode && (!isEpisodeActive || playbackState === "loading")) {
      return "loading";
    }
    if (isEpisodeActive && playbackState === "loading") return "loading";
    if (!isEpisodeActive || !isEpisodeLoaded) return "not-loaded";
    if (playbackState === "playing") return "playing";
    if (playbackState === "paused") return "paused";
    return "loaded-active";
  })();

  const isLoading = viewedEpisodeState === "loading";
  const isPlaying = viewedEpisodeState === "playing";
  const canToggle =
    hasIdentity &&
    !isLoading &&
    !hasActivePlaybackControlIntent &&
    (canUseServer || hasPlayableLocalDownload);

  const handleToggle = async () => {
    if (!hasIdentity || isLoading || hasActivePlaybackControlIntent) return;
    if (!isEpisodeActive) {
      setPendingLoadKey(episodeKey);
      try {
        await playerService.requestStartEpisode(identity.libraryItemId, identity.episodeId, {
          episodeTitle: episodeTitle ?? undefined,
          podcastTitle: podcastTitle ?? undefined,
        });
      } catch (error) {
        if (isStreamedPlaybackStartFailure(error)) {
          showStreamedPlaybackStartFailureToast();
        } else {
          toast.error("Unable to play");
        }
        setPendingLoadKey(null);
      }
      return;
    }
    if (!isEpisodeLoaded) {
      setPendingLoadKey(episodeKey);
    }
    try {
      if (isPlaying) {
        await playerService.requestPause();
      } else {
        await playerService.requestPlay();
      }
    } catch (error) {
      if (isStreamedPlaybackStartFailure(error)) {
        showStreamedPlaybackStartFailureToast();
      } else {
        toast.error(isPlaying ? "Unable to pause" : "Unable to play");
      }
      setPendingLoadKey(null);
    }
  };

  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingBottom: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isLoading ? "Loading episode" : isPlaying ? "Pause" : "Play"}
        onPress={() => {
          void handleToggle();
        }}
        disabled={!canToggle}
        style={({ pressed }) => ({
          width: 72,
          height: 72,
          borderRadius: 36,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: canToggle ? themeColors.accent : themeColors.textMuted,
          opacity: !canToggle ? 0.55 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          boxShadow: "0 14px 24px rgba(15, 23, 42, 0.25)",
        })}
      >
        <PlayPauseAnimation
          visualState={viewedEpisodeState}
          size={34}
          duration={600}
          tintColor="#f8fafc"
        />
      </Pressable>
    </View>
  );
};
