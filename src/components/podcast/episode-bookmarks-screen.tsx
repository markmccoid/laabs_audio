import type { BookmarkViewRecord } from "@/bookmarks/bookmark-contracts";
import { BookmarkListView } from "@/components/bookmarks/bookmark-list-view";
import {
  useEpisodeBookmarkActions,
  useEpisodeBookmarks,
  useResolvedEpisodeListeningOwnerKey,
} from "@/podcast/episode-bookmarks-store";
import type { EpisodeIdentity } from "@/podcast/episode-identity";
import { playerService, usePlaybackStore } from "@/player";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const sanitizeFileSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

const toCsvField = (value: string | number) => {
  const normalized = String(value ?? "");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
};

export const EpisodeBookmarksScreen = () => {
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    episodeId?: string | string[];
    episodeTitle?: string | string[];
    podcastTitle?: string | string[];
    durationSeconds?: string | string[];
  }>();
  const identity: EpisodeIdentity = {
    libraryItemId: resolveParam(params.libraryItemId) ?? "",
    episodeId: resolveParam(params.episodeId) ?? "",
  };
  const episodeTitle = resolveParam(params.episodeTitle) ?? "Episode";
  const podcastTitle = resolveParam(params.podcastTitle) ?? "Podcast";
  const durationSeconds = resolveParam(params.durationSeconds) ?? "0";
  const ownerUserId = useResolvedEpisodeListeningOwnerKey(identity);
  const bookmarks = useEpisodeBookmarks(ownerUserId, identity);
  const { remove } = useEpisodeBookmarkActions();
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const activeEpisodeId = usePlaybackStore((state) => state.episodeId);
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(
    () => () => {
      void playerService.restoreListeningPositionAfterPreview();
    },
    [],
  );

  const routeParams = {
    ...identity,
    episodeTitle,
    podcastTitle,
    durationSeconds,
  };

  const viewRecords: BookmarkViewRecord[] = bookmarks.map((bookmark) => ({
    ...bookmark,
    endTimeSeconds: bookmark.endTimeSeconds ?? null,
    statusLabel: bookmark.kind === "clip" ? "Clip" : null,
  }));

  const playBookmark = async (record: BookmarkViewRecord) => {
    if (pendingPlayId) return;
    setPendingPlayId(record.id);
    try {
      await playerService.cancelPreviewForExplicitNavigation();
      if (
        activeLibraryItemId !== identity.libraryItemId ||
        activeEpisodeId !== identity.episodeId
      ) {
        await playerService.loadEpisode(identity.libraryItemId, identity.episodeId, {
          autoPlay: false,
          episodeTitle,
          podcastTitle,
        });
      }
      await playerService.seekTo(record.startTimeSeconds * 1000);
      await playerService.play();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to play bookmark");
    } finally {
      setPendingPlayId(null);
      router.back();
    }
  };

  const deleteBookmark = (record: BookmarkViewRecord) => {
    if (!ownerUserId || pendingDeleteId) return;
    setPendingDeleteId(record.id);
    try {
      remove(ownerUserId, record.id);
      toast.success("Bookmark deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete bookmark");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const buildCsv = () => {
    const header = [
      "libraryItemId",
      "episodeId",
      "podcastTitle",
      "episodeTitle",
      "kind",
      "startTimeSeconds",
      "endTimeSeconds",
      "bookmarkTitle",
      "notes",
      "serverStatus",
    ];
    const rows = bookmarks.map((bookmark) =>
      [
        identity.libraryItemId,
        identity.episodeId,
        podcastTitle,
        episodeTitle,
        bookmark.kind,
        bookmark.startTimeSeconds,
        bookmark.endTimeSeconds ?? "",
        bookmark.title,
        bookmark.note ?? "",
        bookmark.serverStatus,
      ]
        .map(toCsvField)
        .join(","),
    );
    return [header.join(","), ...rows].join("\n");
  };

  const exportBookmarks = async (format: "json" | "csv") => {
    if (!bookmarks.length || isExporting) return;
    let fileUri: string | null = null;
    setIsExporting(true);
    try {
      if (!FileSystem.cacheDirectory) throw new Error("Cache directory is unavailable");
      const directory = `${FileSystem.cacheDirectory}bookmark_exports/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const safeShowId = sanitizeFileSegment(identity.libraryItemId);
      const safeEpisodeId = sanitizeFileSegment(identity.episodeId);
      fileUri = `${directory}bookmarks-${safeShowId}-${safeEpisodeId}.${format}`;
      const body =
        format === "json"
          ? JSON.stringify(
              {
                schemaVersion: 1,
                exportKind: "episode-bookmark-backup",
                exportedAt: new Date().toISOString(),
                ...identity,
                podcastTitle,
                episodeTitle,
                bookmarks,
              },
              null,
              2,
            )
          : buildCsv();
      await FileSystem.writeAsStringAsync(fileUri, body, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        toast.info("Sharing is not available on this device");
        return;
      }
      await Sharing.shareAsync(fileUri, {
        dialogTitle: "Export bookmarks",
        mimeType: format === "json" ? "application/json" : "text/csv",
        UTI: format === "json" ? "public.json" : "public.comma-separated-values-text",
      });
    } catch (error) {
      console.warn("[EpisodeBookmarksScreen] Export failed", error);
      toast.error("Unable to export bookmarks");
    } finally {
      setIsExporting(false);
      if (fileUri) {
        try {
          const info = await FileSystem.getInfoAsync(fileUri);
          if (info.exists) await FileSystem.deleteAsync(fileUri);
        } catch {
          // Temporary backup cleanup is best effort.
        }
      }
    }
  };

  const openExportFormatPicker = () => {
    if (!bookmarks.length) {
      toast.info("No bookmarks to export");
      return;
    }
    Alert.alert("Export Bookmarks", "Choose a format", [
      { text: "Cancel", style: "cancel" },
      { text: "JSON", onPress: () => void exportBookmarks("json") },
      { text: "CSV", onPress: () => void exportBookmarks("csv") },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: "Bookmarks" }} />
      <BookmarkListView
        model={{
          records: viewRecords,
          isExporting,
          pendingPlayId,
          pendingDeleteId,
        }}
        actions={{
          onClose: () => router.back(),
          onExport: openExportFormatPicker,
          onPlay: (record) => void playBookmark(record),
          onOpenDetail: (record) =>
            router.push({
              pathname: "/episode-bookmark-detail",
              params: { ...routeParams, bookmarkId: record.id },
            }),
          onDelete: deleteBookmark,
        }}
      />
    </>
  );
};
