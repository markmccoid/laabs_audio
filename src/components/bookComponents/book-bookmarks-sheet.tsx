import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import type { BookmarkViewRecord } from "@/bookmarks/bookmark-contracts";
import { BookmarkListView } from "@/components/bookmarks/bookmark-list-view";
import { useGetItemDetails, useGetUserServerState } from "@/hooks/abs-data-hooks";
import {
  activateBookmarkRelocationUndo,
  playerService,
  usePlaybackStore,
  useTemporaryPlaybackStore,
} from "@/player";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import { formatSeconds } from "@/utils/formatUtils";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";
const BOOKMARK_RELOCATION_TOAST_ID = "bookmark-progress-relocation";
const sanitizeFileSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
const toCsvField = (value: string | number) => {
  const normalized = String(value ?? "");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
};

type BookmarkExportRow = {
  libraryItemId: string;
  bookName: string;
  kind: "point" | "clip";
  startTimeSeconds: number;
  endTimeSeconds: number | null;
  bookmarkTitle: string;
  notes: string;
  localBookmarkId: string;
  serverLinkStatus: string;
  serverBookmarkTimeSeconds: number | null;
  createdAt: number;
  updatedAt: number;
};

const toBookmarksCsv = (rows: BookmarkExportRow[]) => {
  const header = [
    "libraryItemId",
    "bookName",
    "kind",
    "startTimeSeconds",
    "endTimeSeconds",
    "bookmarkTitle",
    "notes",
  ];
  const lines = rows.map((row) =>
    [
      toCsvField(row.libraryItemId),
      toCsvField(row.bookName),
      toCsvField(row.kind),
      toCsvField(row.startTimeSeconds),
      toCsvField(row.endTimeSeconds ?? ""),
      toCsvField(row.bookmarkTitle),
      toCsvField(row.notes),
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
};

export const BookBookmarksSheet = () => {
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
  const { deleteBookmark } = useDeviceBooksActions();
  useGetUserServerState();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const { data: itemDetails } = useGetItemDetails(libraryItemId);
  const bookName = itemDetails?.title ?? itemDetails?.media?.metadata?.title ?? "";
  const [pendingBookmarkId, setPendingBookmarkId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const isBookmarkPlayPending = pendingBookmarkId !== null;
  const isViewedBookLoaded =
    activeLibraryItemId === libraryItemId && activeEpisodeId === null && queueLength > 0;
  const isThisBookmarkListTemporaryPlayback =
    temporarySurface === "bookmark-list" &&
    temporaryLibraryItemId === libraryItemId &&
    temporaryEpisodeId === null &&
    temporaryBookmarkId !== null &&
    temporaryKind !== null &&
    temporaryReturnPositionMs !== null;

  const resolvedUserKey = useResolvedListeningOwnerKey(libraryItemId);

  const localBookmarksForUser = useDeviceBooksStore((state) =>
    resolvedUserKey ? state.localBookmarksByUser[resolvedUserKey] : undefined,
  );
  const bookmarks = useMemo(() => {
    if (!libraryItemId) return [];
    return Object.values(localBookmarksForUser ?? {})
      .filter((bookmark) => bookmark.libraryItemId === libraryItemId)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  }, [libraryItemId, localBookmarksForUser]);

  const getBookmarkDisplayTitle = (bookmark: LocalBookmarkRecord) => bookmark.title.trim();

  useEffect(() => {
    return () => {
      void playerService.returnFromTemporaryPlayback({
        surface: "bookmark-list",
        libraryItemId,
        episodeId: null,
      });
    };
  }, [libraryItemId]);

  const buildExportRows = (): BookmarkExportRow[] => {
    if (!libraryItemId) return [];
    return bookmarks.map((bookmark) => ({
      libraryItemId,
      bookName,
      kind: bookmark.kind,
      startTimeSeconds: bookmark.startTimeSeconds,
      endTimeSeconds: bookmark.kind === "clip" ? (bookmark.endTimeSeconds ?? null) : null,
      bookmarkTitle: getBookmarkDisplayTitle(bookmark),
      notes: bookmark.note?.trim() ?? "",
      localBookmarkId: bookmark.id,
      serverLinkStatus: bookmark.serverLink.status,
      serverBookmarkTimeSeconds:
        bookmark.serverLink.status === "matched" || bookmark.serverLink.status === "pendingCreate"
          ? bookmark.serverLink.timeSeconds
          : null,
      createdAt: bookmark.createdAt,
      updatedAt: bookmark.updatedAt,
    }));
  };

  const buildBookmarkBackupExport = () => ({
    schemaVersion: 1,
    exportKind: "bookmark-backup",
    exportedAt: new Date().toISOString(),
    libraryItemId,
    bookName,
    bookmarks: buildExportRows(),
  });

  const exportBookmarks = async (format: "json" | "csv") => {
    if (!libraryItemId || isExporting) return;
    const rows = buildExportRows();
    if (!rows.length) {
      toast.info("No bookmarks to export");
      return;
    }

    let exportFileUri: string | null = null;
    setIsExporting(true);
    try {
      if (!FileSystem.cacheDirectory) {
        throw new Error("Cache directory is unavailable");
      }

      const exportDirectory = `${FileSystem.cacheDirectory}bookmark_exports/`;
      await FileSystem.makeDirectoryAsync(exportDirectory, {
        intermediates: true,
      });

      const safeLibraryItemId = sanitizeFileSegment(libraryItemId);
      const fileName = `bookmarks-${safeLibraryItemId}.${format}`;
      exportFileUri = `${exportDirectory}${fileName}`;

      const fileBody =
        format === "json"
          ? JSON.stringify(buildBookmarkBackupExport(), null, 2)
          : toBookmarksCsv(rows);

      await FileSystem.writeAsStringAsync(exportFileUri, fileBody, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        toast.info("Sharing is not available on this device");
        return;
      }

      await Sharing.shareAsync(exportFileUri, {
        dialogTitle: "Export bookmarks",
        mimeType: format === "json" ? "application/json" : "text/csv",
        UTI: format === "json" ? "public.json" : "public.comma-separated-values-text",
      });
    } catch (error) {
      console.warn("[BookBookmarksSheet] Export failed", error);
      toast.error("Unable to export bookmarks");
    } finally {
      setIsExporting(false);
      if (exportFileUri) {
        try {
          const info = await FileSystem.getInfoAsync(exportFileUri);
          if (info.exists) {
            await FileSystem.deleteAsync(exportFileUri);
          }
        } catch {
          // Ignore cleanup errors for temp export files.
        }
      }
    }
  };

  const openExportFormatPicker = () => {
    if (isExporting || isBookmarkPlayPending) return;
    const rows = buildExportRows();
    if (!rows.length) {
      toast.info("No bookmarks to export");
      return;
    }

    Alert.alert("Export Bookmarks", "Choose a format", [
      { text: "Cancel", style: "cancel" },
      {
        text: "JSON",
        onPress: () => {
          void exportBookmarks("json");
        },
      },
      {
        text: "CSV",
        onPress: () => {
          void exportBookmarks("csv");
        },
      },
    ]);
  };

  const handleTemporaryPlayback = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || isBookmarkPlayPending) return;
    if (!isViewedBookLoaded) {
      toast.info("Load this book to play bookmarks without moving progress.");
      return;
    }

    setPendingBookmarkId(bookmark.id);
    try {
      if (isThisBookmarkListTemporaryPlayback && temporaryBookmarkId === bookmark.id) {
        if (temporaryStatus === "playing") {
          await playerService.pauseTemporaryPlayback();
        } else {
          await playerService.resumeTemporaryPlayback();
        }
      } else {
        await playerService.playBookmarkTemporarily({
          libraryItemId,
          bookmarkId: bookmark.id,
          bookmarkTitle: getBookmarkDisplayTitle(bookmark),
          kind: bookmark.kind,
          startTimeSeconds: bookmark.startTimeSeconds,
          endTimeSeconds: bookmark.endTimeSeconds,
        });
      }
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed temporary bookmark playback", error);
      toast.error(error instanceof Error ? error.message : "Unable to play bookmark");
    } finally {
      setPendingBookmarkId(null);
    }
  };

  const handleHeaderPlayback = async () => {
    if (!isThisBookmarkListTemporaryPlayback) return;
    if (temporaryStatus === "playing") {
      await playerService.pauseTemporaryPlayback();
    } else {
      await playerService.resumeTemporaryPlayback();
    }
  };

  const returnToListeningPosition = async () => {
    if (!libraryItemId) return;
    await playerService.returnFromTemporaryPlayback({
      surface: "bookmark-list",
      libraryItemId,
      episodeId: null,
    });
  };

  const closeBookmarks = async () => {
    await returnToListeningPosition();
    router.back();
  };

  const openBookmarkDetail = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || isBookmarkPlayPending) return;
    await returnToListeningPosition();
    router.push({
      pathname: "/book-bookmark-detail",
      params: {
        libraryItemId,
        bookmarkId: bookmark.id,
      },
    });
  };

  const handleDeleteBookmark = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || pendingDeleteId !== null || isBookmarkPlayPending) return;

    setPendingDeleteId(bookmark.id);
    try {
      if (isThisBookmarkListTemporaryPlayback && temporaryBookmarkId === bookmark.id) {
        await returnToListeningPosition();
      }
      await deleteBookmark(libraryItemId, bookmark.startTimeSeconds, {
        userKey: resolvedUserKey,
        localBookmarkId: bookmark.id,
      });
      toast.success("Bookmark deleted");
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed to delete bookmark", error);
      toast.error("Unable to delete bookmark");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const moveProgressToBookmark = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || isBookmarkPlayPending) return;
    setPendingBookmarkId(bookmark.id);
    try {
      const token = await playerService.relocateToBookmark({
        libraryItemId,
        positionMs: secondsToMs(bookmark.startTimeSeconds),
      });
      router.back();
      const movedTime = getBookmarkTimeLabel(bookmark.startTimeSeconds);
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
      setPendingBookmarkId(null);
    }
  };

  const handleExport = async () => {
    await returnToListeningPosition();
    openExportFormatPicker();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Bookmarks",
        }}
      />
      <BookmarkListView
        model={{
          records: (libraryItemId ? bookmarks : []).map(
            (bookmark): BookmarkViewRecord => ({
              ...bookmark,
              endTimeSeconds: bookmark.endTimeSeconds ?? null,
              statusLabel:
                bookmark.serverLink.status !== "matched"
                  ? "Unmatched"
                  : bookmark.kind === "clip"
                    ? "Clip"
                    : null,
            }),
          ),
          isExporting,
          pendingPlayId: pendingBookmarkId,
          pendingDeleteId,
          isMediaLoaded: isViewedBookLoaded,
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
          onTogglePlayback: (record) => {
            const bookmark = bookmarks.find((candidate) => candidate.id === record.id);
            if (bookmark) void handleTemporaryPlayback(bookmark);
          },
          onToggleHeaderPlayback: () => void handleHeaderPlayback(),
          onReturn: () => void returnToListeningPosition(),
          onMoveProgress: (record) => {
            const bookmark = bookmarks.find((candidate) => candidate.id === record.id);
            if (bookmark) void moveProgressToBookmark(bookmark);
          },
          onOpenDetail: (record) => {
            const bookmark = bookmarks.find((candidate) => candidate.id === record.id);
            if (bookmark) void openBookmarkDetail(bookmark);
          },
          onDelete: (record) => {
            const bookmark = bookmarks.find((candidate) => candidate.id === record.id);
            if (bookmark) void handleDeleteBookmark(bookmark);
          },
        }}
      />
    </>
  );
};
