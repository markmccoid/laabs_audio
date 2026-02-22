import type { LibraryItemSummary } from "@/api/library-items-api";
import {
  selectIsBookFullyDownloaded,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { toast } from "react-native-sonner";
import { Pressable, Text, View } from "react-native";

const completionToastHandledByLibraryItemId = new Set<string>();
const logDownloadControls = (event: string, payload?: Record<string, unknown>) => {
  if (!__DEV__) return;
  console.log(`[download-controls] ${event}`, payload ?? {});
};

const formatPercent = (value: number | undefined) => {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, value as number))}%`;
};

type Props = {
  libraryItemId?: string;
  summary?: LibraryItemSummary | null;
  context?: "inline" | "sheet";
};

const DownloadControls = ({ libraryItemId, summary, context = "inline" }: Props) => {
  const themeColors = useThemeColors();
  const pathname = usePathname();
  const { downloadBook, cancelDownload, deleteDownloadedBookData } = useDeviceBooksActions();
  const downloadProgress = useDeviceBooksStore((state) => state.downloadProgress);
  const isDownloaded = useDeviceBooksStore((state) => {
    if (!libraryItemId) return false;
    return selectIsBookFullyDownloaded(state, libraryItemId);
  });
  const isDownloading = downloadProgress?.libraryItemId === libraryItemId;
  const showDownloadingState = isDownloading && !isDownloaded;
  const isBookDownloadsSheet = context === "sheet";
  const isAnotherDownloadActive =
    Boolean(downloadProgress?.libraryItemId) && downloadProgress?.libraryItemId !== libraryItemId;
  const progressValue = showDownloadingState ? (downloadProgress?.progress ?? 0) : 0;
  const previousIsDownloadingRef = useRef(isDownloading);

  useEffect(() => {
    if (libraryItemId && isDownloading) {
      completionToastHandledByLibraryItemId.delete(libraryItemId);
    }
    const wasDownloading = previousIsDownloadingRef.current;
    if (wasDownloading && !isDownloading && isDownloaded && libraryItemId) {
      if (!isBookDownloadsSheet) {
        previousIsDownloadingRef.current = isDownloading;
        return;
      }
      if (completionToastHandledByLibraryItemId.has(libraryItemId)) {
        previousIsDownloadingRef.current = isDownloading;
        return;
      }
      completionToastHandledByLibraryItemId.add(libraryItemId);
      logDownloadControls("complete", { libraryItemId, pathname, context });
      toast.success("Download complete", {
        description: summary?.title ?? "This book is ready for offline playback.",
        duration: 5_000,
      });

      router.back();
    }
    previousIsDownloadingRef.current = isDownloading;
  }, [context, isBookDownloadsSheet, isDownloaded, isDownloading, libraryItemId, pathname, summary?.title]);

  const handleDownload = () => {
    if (!libraryItemId) return;
    logDownloadControls("start:pressed", {
      libraryItemId,
      pathname,
      context,
      activeDownloadLibraryItemId: downloadProgress?.libraryItemId ?? null,
    });
    void downloadBook(libraryItemId, { summary: summary ?? undefined });
  };

  const handleCancel = () => {
    logDownloadControls("cancel:pressed", {
      libraryItemId: libraryItemId ?? null,
      pathname,
      context,
      activeDownloadLibraryItemId: downloadProgress?.libraryItemId ?? null,
    });
    void cancelDownload();
  };

  const handleDelete = async () => {
    if (!libraryItemId) return;
    logDownloadControls("remove:pressed", { libraryItemId, pathname, context });
    await deleteDownloadedBookData(libraryItemId);
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
        Offline Download
      </Text>
      <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
        {isDownloaded
          ? "Downloaded and ready for offline playback."
          : "Download this book for offline playback."}
      </Text>

      {showDownloadingState ? (
        <View style={{ gap: 8 }}>
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
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              {downloadProgress?.currentFileProcessing ?? "Preparing download..."}
            </Text>
            <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
              {formatPercent(progressValue)}
            </Text>
          </View>
          <Text selectable style={{ fontSize: 12, color: themeColors.textMuted }}>
            {downloadProgress?.numberOfFilesDownloaded ?? 0}/{downloadProgress?.numberOfFiles ?? 0}{" "}
            files
          </Text>
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => ({
              marginTop: 4,
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
              Cancel Download
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
              style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: "#ffffff" }}
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
