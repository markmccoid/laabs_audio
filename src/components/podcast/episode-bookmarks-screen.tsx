import type { BookmarkViewRecord } from "@/bookmarks/bookmark-contracts";
import { BookmarkListView } from "@/components/bookmarks/bookmark-list-view";
import {
  useEpisodeBookmarkActions,
  useEpisodeBookmarks,
  useResolvedEpisodeListeningOwnerKey,
} from "@/podcast/episode-bookmarks-store";
import type { EpisodeIdentity } from "@/podcast/episode-identity";
import {
  activateBookmarkRelocationUndo,
  playerService,
  usePlaybackStore,
  useTemporaryPlaybackStore,
} from "@/player";
import { formatSeconds } from "@/utils/formatUtils";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const sanitizeFileSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
const BOOKMARK_RELOCATION_TOAST_ID = "bookmark-progress-relocation";
const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";

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
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const temporarySurface = useTemporaryPlaybackStore((state) => state.surface);
  const temporaryLibraryItemId = useTemporaryPlaybackStore((state) => state.libraryItemId);
  const temporaryEpisodeId = useTemporaryPlaybackStore((state) => state.episodeId);
  const temporaryBookmarkId = useTemporaryPlaybackStore((state) => state.bookmarkId);
  const temporaryBookmarkTitle = useTemporaryPlaybackStore((state) => state.bookmarkTitle);
  const temporaryKind = useTemporaryPlaybackStore((state) => state.kind);
  const temporaryStartMs = useTemporaryPlaybackStore((state) => state.startMs);
  const temporaryEndMs = useTemporaryPlaybackStore((state) => state.endMs);
  const temporaryPositionMs = useTemporaryPlaybackStore((state) => state.positionMs);
  const temporaryReturnPositionMs = useTemporaryPlaybackStore((state) => state.returnPositionMs);
  const temporaryStatus = useTemporaryPlaybackStore((state) => state.status);
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const isEpisodeLoaded =
    activeLibraryItemId === identity.libraryItemId &&
    activeEpisodeId === identity.episodeId &&
    queueLength > 0;
  const isThisBookmarkListTemporaryPlayback =
    temporarySurface === "bookmark-list" &&
    temporaryLibraryItemId === identity.libraryItemId &&
    temporaryEpisodeId === identity.episodeId &&
    temporaryBookmarkId !== null &&
    temporaryKind !== null &&
    temporaryReturnPositionMs !== null;

  useEffect(
    () => () => {
      void playerService.returnFromTemporaryPlayback({
        surface: "bookmark-list",
        libraryItemId: identity.libraryItemId,
        episodeId: identity.episodeId,
      });
    },
    [identity.episodeId, identity.libraryItemId],
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
    if (!isEpisodeLoaded) {
      toast.info("Load this episode to play bookmarks without moving progress.");
      return;
    }
    setPendingPlayId(record.id);
    try {
      if (isThisBookmarkListTemporaryPlayback && temporaryBookmarkId === record.id) {
        if (temporaryStatus === "playing") {
          await playerService.pauseTemporaryPlayback();
        } else {
          await playerService.resumeTemporaryPlayback();
        }
      } else {
        await playerService.playBookmarkTemporarily({
          ...identity,
          bookmarkId: record.id,
          bookmarkTitle: record.title.trim(),
          kind: record.kind,
          startTimeSeconds: record.startTimeSeconds,
          endTimeSeconds: record.endTimeSeconds,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to play bookmark");
    } finally {
      setPendingPlayId(null);
    }
  };

  const returnToListeningPosition = async () => {
    await playerService.returnFromTemporaryPlayback({
      surface: "bookmark-list",
      libraryItemId: identity.libraryItemId,
      episodeId: identity.episodeId,
    });
  };

  const handleHeaderPlayback = async () => {
    if (!isThisBookmarkListTemporaryPlayback) return;
    if (temporaryStatus === "playing") {
      await playerService.pauseTemporaryPlayback();
    } else {
      await playerService.resumeTemporaryPlayback();
    }
  };

  const closeBookmarks = async () => {
    await returnToListeningPosition();
    router.back();
  };

  const openBookmarkDetail = async (record: BookmarkViewRecord) => {
    await returnToListeningPosition();
    router.push({
      pathname: "/episode-bookmark-detail",
      params: { ...routeParams, bookmarkId: record.id },
    });
  };

  const deleteBookmark = async (record: BookmarkViewRecord) => {
    if (!ownerUserId || pendingDeleteId) return;
    setPendingDeleteId(record.id);
    try {
      if (isThisBookmarkListTemporaryPlayback && temporaryBookmarkId === record.id) {
        await returnToListeningPosition();
      }
      remove(ownerUserId, record.id);
      toast.success("Bookmark deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete bookmark");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const moveProgressToBookmark = async (record: BookmarkViewRecord) => {
    if (pendingPlayId) return;
    setPendingPlayId(record.id);
    try {
      const token = await playerService.relocateToBookmark({
        ...identity,
        positionMs: record.startTimeSeconds * 1000,
        episodeTitle,
        podcastTitle,
      });
      router.back();
      const movedTime = getBookmarkTimeLabel(record.startTimeSeconds);
      if (!token) {
        toast.success(`Progress moved to ${movedTime}`);
        return;
      }
      toast.success(`Progress moved to ${movedTime}`, {
        id: BOOKMARK_RELOCATION_TOAST_ID,
        duration: 15_000,
        dismissible: true,
        action: {
          label: "Undo",
          onClick: () => {
            void playerService
              .undoBookmarkRelocation(token)
              .then(() => toast.success("Previous listening position restored"))
              .catch((error) =>
                toast.error(
                  error instanceof Error ? error.message : "Unable to restore listening position",
                ),
              );
          },
        },
      });
      activateBookmarkRelocationUndo(token.id, () => toast.dismiss(BOOKMARK_RELOCATION_TOAST_ID));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to move progress");
    } finally {
      setPendingPlayId(null);
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

  const handleExport = async () => {
    await returnToListeningPosition();
    openExportFormatPicker();
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
          isMediaLoaded: isEpisodeLoaded,
          temporaryPlayback: isThisBookmarkListTemporaryPlayback
            ? {
                activeBookmarkId: temporaryBookmarkId,
                activeBookmarkTitle: temporaryBookmarkTitle ?? "Bookmark",
                activeKind: temporaryKind,
                startTimeSeconds: temporaryStartMs / 1000,
                endTimeSeconds: temporaryEndMs === null ? null : temporaryEndMs / 1000,
                positionSeconds: temporaryPositionMs / 1000,
                returnPositionSeconds: temporaryReturnPositionMs / 1000,
                status: temporaryStatus,
              }
            : null,
        }}
        actions={{
          onClose: () => void closeBookmarks(),
          onExport: () => void handleExport(),
          onTogglePlayback: (record) => void playBookmark(record),
          onToggleHeaderPlayback: () => void handleHeaderPlayback(),
          onReturn: () => void returnToListeningPosition(),
          onMoveProgress: (record) => void moveProgressToBookmark(record),
          onOpenDetail: (record) => void openBookmarkDetail(record),
          onDelete: (record) => void deleteBookmark(record),
        }}
      />
    </>
  );
};
