import {
  selectHasPlayableEpisodeDownloadForSession,
  selectIsAnotherEpisodeDownloadActive,
  selectIsEpisodeActivelyDownloading,
  useDeviceEpisodeDownloadsActions,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { playerService } from "@/player";
import { selectIsAnyDownloadActive, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { toast } from "react-native-sonner";

type Props = {
  libraryItemId: string;
  episodeId: string;
  episodeTitle?: string | null;
  podcastTitle?: string | null;
  coverUri?: string | null;
  compact?: boolean;
  context?: "inline" | "sheet";
};

const formatPercent = (value: number | undefined) => {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round((value as number) * 100)))}%`;
};

export const EpisodeDownloadControls = ({
  libraryItemId,
  episodeId,
  episodeTitle,
  podcastTitle,
  coverUri,
  compact = false,
  context = "inline",
}: Props) => {
  const themeColors = useThemeColors();
  const identity = { libraryItemId, episodeId };
  const { downloadEpisode, deleteDownloadedEpisode, cancelDownload } =
    useDeviceEpisodeDownloadsActions();
  const isDownloaded = useDeviceEpisodeDownloadsStore((state) =>
    selectHasPlayableEpisodeDownloadForSession(state, identity),
  );
  const isDownloading = useDeviceEpisodeDownloadsStore((state) =>
    selectIsEpisodeActivelyDownloading(state, identity),
  );
  const isAnotherEpisodeDownloadActive = useDeviceEpisodeDownloadsStore((state) =>
    selectIsAnotherEpisodeDownloadActive(state, identity),
  );
  const isBookDownloadActive = useDeviceBooksStore((state) => selectIsAnyDownloadActive(state));
  const downloadProgress = useDeviceEpisodeDownloadsStore((state) => state.downloadProgress);
  const activeSession = useDeviceEpisodeDownloadsStore((state) => state.activeDownloadSession);
  const showDownloadingState = isDownloading && !isDownloaded;
  const blockedByOther = isAnotherEpisodeDownloadActive || isBookDownloadActive;
  const isEpisodeDownloadsSheet = context === "sheet";

  const handleDownload = () => {
    void downloadEpisode(identity, {
      episodeTitle,
      podcastTitle,
      coverUri,
    }).catch((error) => {
      toast.error("Download failed", {
        description: error instanceof Error ? error.message : "Unable to download this Episode.",
      });
    });
  };

  const handleDelete = () => {
    void (async () => {
      const playbackSnapshot = await playerService.prepareForDownloadedEpisodeDeletion(
        libraryItemId,
        episodeId,
      );
      await deleteDownloadedEpisode(identity);
      await playerService.resumeAfterDownloadedEpisodeDeletion(playbackSnapshot);
      if (isEpisodeDownloadsSheet) {
        router.back();
      }
    })().catch((error) => {
      toast.error("Unable to remove download", {
        description: error instanceof Error ? error.message : undefined,
      });
    });
  };

  if (compact) {
    if (showDownloadingState) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel episode download"
          onPress={() => {
            void cancelDownload();
          }}
          hitSlop={8}
        >
          <Text style={{ color: themeColors.accent, fontSize: 12, fontWeight: "600" }}>
            {formatPercent(downloadProgress?.progress)}
          </Text>
        </Pressable>
      );
    }
    if (isDownloaded) {
      return (
        <Text
          accessibilityLabel="Downloaded"
          style={{ color: themeColors.textMuted, fontSize: 11, fontWeight: "600" }}
        >
          Downloaded
        </Text>
      );
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Download ${episodeTitle ?? "episode"}`}
        disabled={blockedByOther}
        onPress={handleDownload}
        hitSlop={8}
        style={{ opacity: blockedByOther ? 0.4 : 1 }}
      >
        <Text style={{ color: themeColors.accent, fontSize: 12, fontWeight: "600" }}>
          Download
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: "600", color: themeColors.text }}>
        {showDownloadingState ? "Download in Progress" : "Offline Download"}
      </Text>
      {!showDownloadingState ? (
        <Text style={{ fontSize: 12, color: themeColors.textMuted }}>
          {isDownloaded
            ? "Downloaded and ready for offline playback."
            : blockedByOther
              ? "Another download is currently active."
              : "Download this Episode for offline playback."}
        </Text>
      ) : (
        <Text style={{ fontSize: 12, color: themeColors.textMuted }}>
          {activeSession?.phase === "cancelling"
            ? "Cancelling download..."
            : activeSession?.phase === "finalizing"
              ? "Finalizing download..."
              : `${formatPercent(downloadProgress?.progress)} · ${
                  downloadProgress?.currentFileName ?? "Preparing..."
                }`}
        </Text>
      )}

      {showDownloadingState ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel download"
          onPress={() => {
            void cancelDownload();
          }}
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: themeColors.border,
          }}
        >
          <Text style={{ color: themeColors.text, fontWeight: "600" }}>Cancel</Text>
        </Pressable>
      ) : isDownloaded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove download"
          onPress={handleDelete}
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: themeColors.border,
          }}
        >
          <Text style={{ color: themeColors.text, fontWeight: "600" }}>Remove Download</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download episode"
          disabled={blockedByOther}
          onPress={handleDownload}
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: blockedByOther ? themeColors.border : themeColors.accent,
            opacity: blockedByOther ? 0.5 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Download</Text>
        </Pressable>
      )}
    </View>
  );
};
