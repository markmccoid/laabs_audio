import type { LibraryItemSummary } from "@/api/library-items-api";
import {
  selectIsAnotherDownloadActive,
  selectIsBookActivelyDownloading,
  selectIsBookFullyDownloaded,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import type { BookDetailRouteSource } from "@/navigation/book-links";
import { playerService } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatMegabytes } from "@/utils/formatUtils";
import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";
const logDownloadControls = (_event: string, _payload?: Record<string, unknown>) => {};

const formatPercent = (value: number | undefined) => {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, value as number))}%`;
};

type Props = {
  libraryItemId?: string;
  summary?: LibraryItemSummary | null;
  context?: "inline" | "sheet";
  sourceBookRoute?: BookDetailRouteSource | null;
};

const DownloadControls = ({
  libraryItemId,
  summary,
  context = "inline",
  sourceBookRoute,
}: Props) => {
  const themeColors = useThemeColors();
  const pathname = usePathname();
  const { cancelDownload, deleteDownloadedBookData, downloadBook } = useDeviceBooksActions();
  const activeDownloadSession = useDeviceBooksStore((state) => state.activeDownloadSession);
  const downloadProgress = useDeviceBooksStore((state) => state.downloadProgress);
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectIsBookFullyDownloaded(state, libraryItemId);
  });
  const isDownloading = useDeviceBooksStore((state) =>
    selectIsBookActivelyDownloading(state, libraryItemId),
  );
  const showDownloadingState = isDownloading && !isDownloaded;
  const isBookDownloadsSheet = context === "sheet";
  const isAnotherDownloadActive = useDeviceBooksStore((state) =>
    selectIsAnotherDownloadActive(state, libraryItemId),
  );
  const progressValue = showDownloadingState ? (downloadProgress?.progress ?? 0) : 0;
  const currentFileName = downloadProgress?.currentFileName?.trim() || null;
  const currentFileDetails =
    downloadProgress && downloadProgress.currentFileIndex > 0
      ? `File ${downloadProgress.currentFileIndex}/${downloadProgress.numberOfFiles} · ${formatMegabytes(downloadProgress.currentFileSize)}`
      : null;
  const progressStatusLabel =
    activeDownloadSession?.phase === "cancelling"
      ? "Cancelling download..."
      : activeDownloadSession?.phase === "finalizing"
        ? "Finalizing download..."
        : currentFileName ?? "Preparing download...";

  const handleDownload = () => {
    if (!libraryItemId) return;
    logDownloadControls("start:pressed", {
      libraryItemId,
      pathname,
      context,
      activeDownloadLibraryItemId:
        activeDownloadSession?.libraryItemId ?? downloadProgress?.libraryItemId ?? null,
    });
    void downloadBook(libraryItemId, {
      summary: summary ?? undefined,
      sourceBookRoute,
    });
  };

  const handleDelete = async () => {
    if (!libraryItemId) return;
    logDownloadControls("remove:pressed", { libraryItemId, pathname, context });
    const playbackSnapshot = await playerService.prepareForDownloadedBookDeletion(libraryItemId);
    await deleteDownloadedBookData(libraryItemId);
    await playerService.resumeAfterDownloadedBookDeletion(playbackSnapshot);
    if (isBookDownloadsSheet) {
      router.back();
    }
  };

  return (
    <View
      className="z-10"
      style={{
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        padding: 16,
        gap: 10,
        boxShadow: "0 10px 22px rgba(15, 23, 42, 0.1)",
      }}
    >
      <Text selectable style={{ fontSize: 16, fontWeight: "600", color: themeColors.text }}>
        {showDownloadingState ? "Download in Progress" : "Offline Download"}
      </Text>
      {!showDownloadingState ? (
        <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
          {isDownloaded
            ? "Downloaded and ready for offline playback."
            : isAnotherDownloadActive
              ? "Another book is currently downloading."
              : "Download this book for offline playback."}
        </Text>
      ) : null}

      {showDownloadingState ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <Text
              selectable
              numberOfLines={2}
              ellipsizeMode="middle"
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: "700",
                color: themeColors.text,
              }}
            >
              {progressStatusLabel}
            </Text>
            <Text
              selectable
              style={{
                fontSize: 16,
                fontWeight: "800",
                color: themeColors.text,
              }}
            >
              {formatPercent(progressValue)}
            </Text>
          </View>
          <View
            style={{
              height: 6,
              width: "100%",
              borderRadius: 999,
              backgroundColor: themeColors.border,
            }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 999,
                backgroundColor: themeColors.accent,
                width: `${progressValue}%`,
              }}
            />
          </View>
          {downloadProgress && currentFileDetails ? (
            <Text
              selectable
              style={{ fontSize: 14, fontWeight: "600", color: themeColors.textMuted }}
            >
              {currentFileDetails}
            </Text>
          ) : downloadProgress ? (
            <Text
              selectable
              style={{ fontSize: 14, fontWeight: "600", color: themeColors.textMuted }}
            >
              {downloadProgress.numberOfFiles} files queued
            </Text>
          ) : (
            <Text
              selectable
              style={{ fontSize: 14, fontWeight: "600", color: themeColors.textMuted }}
            >
              Waiting for file details...
            </Text>
          )}
          <Pressable
            onPress={() => {
              void cancelDownload();
            }}
            disabled={activeDownloadSession?.phase === "cancelling"}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              paddingVertical: 8,
              opacity: activeDownloadSession?.phase === "cancelling" ? 0.6 : pressed ? 0.8 : 1,
              backgroundColor: themeColors.bg,
            })}
          >
            <Text
              selectable
              style={{
                textAlign: "center",
                fontSize: 13,
                fontWeight: "600",
                color: themeColors.text,
              }}
            >
              {activeDownloadSession?.phase === "cancelling" ? "Cancelling..." : "Cancel Download"}
            </Text>
          </Pressable>
        </View>
      ) : isDownloaded ? (
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={() => {
              void handleDelete();
            }}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              paddingVertical: 8,
              opacity: pressed ? 0.8 : 1,
              backgroundColor: themeColors.bg,
            })}
          >
            <Text
              selectable
              style={{
                textAlign: "center",
                fontSize: 13,
                fontWeight: "600",
                color: themeColors.text,
              }}
            >
              Remove Download
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={handleDownload}
            disabled={isAnotherDownloadActive}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              paddingVertical: 10,
              backgroundColor: isAnotherDownloadActive ? themeColors.textMuted : themeColors.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              selectable
              style={{
                textAlign: "center",
                fontSize: 13,
                fontWeight: "600",
                color: isAnotherDownloadActive ? "#FFFFFF" : themeColors.accentForeground,
              }}
            >
              {isAnotherDownloadActive ? "Download In Progress" : "Download Book"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

export default DownloadControls;
