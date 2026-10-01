import { useAuthStore } from "@/auth/auth-store";
import { canUseAudiobookshelfServer } from "@/auth/server-connection";
import type { EpisodeIdentity } from "@/podcast/episode-identity";
import { playerService, usePlaybackStore } from "@/player";
import { usePlaybackControls } from "@/player/use-playback-controls";
import { requestPlaybackToggleForIdentity } from "@/player/request-playback-toggle";
import { showPlaybackError } from "@/player/show-playback-error";
import {
  selectHasPlayableEpisodeDownloadForSession,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, View } from "react-native";

type Props = {
  identity: EpisodeIdentity;
  episodeTitle?: string | null;
  podcastTitle?: string | null;
  variant?: "play-only" | "full";
};

const resolveSeekBackwardIcon = (seconds: number): SFSymbol => {
  switch (Math.round(seconds)) {
    case 10:
      return "gobackward.10";
    case 15:
      return "gobackward.15";
    case 30:
      return "gobackward.30";
    case 45:
      return "gobackward.45";
    case 60:
      return "gobackward.60";
    default:
      return "gobackward";
  }
};

const resolveSeekForwardIcon = (seconds: number): SFSymbol => {
  switch (Math.round(seconds)) {
    case 10:
      return "goforward.10";
    case 15:
      return "goforward.15";
    case 30:
      return "goforward.30";
    case 45:
      return "goforward.45";
    case 60:
      return "goforward.60";
    default:
      return "goforward";
  }
};

const SeekButton = ({
  accessibilityLabel,
  icon,
  onPress,
  disabled,
}: {
  accessibilityLabel: string;
  icon: SFSymbol;
  onPress: () => void;
  disabled: boolean;
}) => {
  const themeColors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 26,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        backgroundColor: pressed ? themeColors.bg : "transparent",
      })}
    >
      <SymbolView
        name={icon}
        size={30}
        tintColor={disabled ? themeColors.textMuted : themeColors.text}
      />
    </Pressable>
  );
};

export const EpisodeControls = ({
  identity,
  episodeTitle,
  podcastTitle,
  variant = "play-only",
}: Props) => {
  const themeColors = useThemeColors();
  const isOnline = useAuthStore((state) => state.isOnline);
  const serverConnectionStatus = useAuthStore((state) => state.serverConnectionStatus);
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playbackError = usePlaybackStore((state) => state.error);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const currentEpisodeId = usePlaybackStore((state) => state.episodeId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const hasPlayableLocalDownload = useDeviceEpisodeDownloadsStore((state) =>
    selectHasPlayableEpisodeDownloadForSession(state, identity),
  );
  const canUseServer = canUseAudiobookshelfServer({ isOnline, serverConnectionStatus });
  const hasIdentity = Boolean(identity.libraryItemId && identity.episodeId);
  const isEpisodeActive = hasIdentity && currentLibraryItemId === identity.libraryItemId &&
    currentEpisodeId === identity.episodeId;
  const isEpisodeLoaded = isEpisodeActive && queueLength > 0;
  const canStart = canUseServer || hasPlayableLocalDownload || Boolean(isEpisodeActive && playbackError);
  const { canToggle, action, isPreparing } = usePlaybackControls(identity, canStart);
  const canSeek = isEpisodeLoaded && !isPreparing &&
    (playbackState === "playing" || playbackState === "paused" || playbackState === "ready");

  const handleToggle = async () => {
    try {
      await requestPlaybackToggleForIdentity(identity, canStart, {
        episodeTitle: episodeTitle ?? undefined,
        podcastTitle: podcastTitle ?? undefined,
      });
    } catch (error) {
      showPlaybackError(error);
    }
  };

  const playButton = (
    <View style={{ alignItems: "center", justifyContent: "center", paddingBottom: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action === "pause" ? "Pause" : "Play"}
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
        <SymbolView name={action === "pause" ? "pause.fill" : "play.fill"} size={34} tintColor="#f8fafc" />
      </Pressable>
    </View>
  );

  if (variant === "play-only") return playButton;

  return (
    <View
      style={{
        width: "100%",
        borderRadius: 28,
        borderCurve: "continuous",
        backgroundColor: themeColors.surface,
        paddingVertical: 16,
        paddingHorizontal: 12,
        boxShadow: "0 18px 30px rgba(15, 23, 42, 0.12)",
        borderWidth: 1,
        borderColor: themeColors.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
        }}
      >
        <SeekButton
          accessibilityLabel={`Skip back ${seekBackwardSeconds} seconds`}
          icon={resolveSeekBackwardIcon(seekBackwardSeconds)}
          onPress={() => {
            void playerService.skipBy(seekBackwardSeconds, true);
          }}
          disabled={!canSeek}
        />
        {playButton}
        <SeekButton
          accessibilityLabel={`Skip forward ${seekForwardSeconds} seconds`}
          icon={resolveSeekForwardIcon(seekForwardSeconds)}
          onPress={() => {
            void playerService.skipBy(seekForwardSeconds);
          }}
          disabled={!canSeek}
        />
      </View>
    </View>
  );
};
