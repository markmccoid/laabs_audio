import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import type { BookmarkViewRecord } from "@/bookmarks/bookmark-contracts";
import { BookmarkListView } from "@/components/bookmarks/bookmark-list-view";
import { useGetItemDetails, useGetUserServerState } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
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
  const queueLength = usePlaybackStore((state) => state.queue.length);
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
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

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
      await FileSystem.makeDirectoryAsync(exportDirectory, { intermediates: true });

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

  const handleBookmarkPress = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || isBookmarkPlayPending) return;
    const targetPositionMs = secondsToMs(bookmark.startTimeSeconds);
    const isViewedBookActive = activeLibraryItemId === libraryItemId && queueLength > 0;

    setPendingBookmarkId(bookmark.id);
    try {
      await playerService.cancelPreviewForExplicitNavigation();
      if (isViewedBookActive) {
        await playerService.seekTo(targetPositionMs);
        await playerService.play({ touchProgressCache: false });
      } else {
        await playerService.loadBook(libraryItemId, { autoPlay: false });
        await playerService.seekTo(targetPositionMs);
        await playerService.play();
      }
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed to jump to bookmark", error);
    } finally {
      setPendingBookmarkId(null);
      router.back();
    }
  };

  const openBookmarkDetail = (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || isBookmarkPlayPending) return;
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
        }}
        actions={{
          onClose: () => router.back(),
          onExport: openExportFormatPicker,
          onPlay: (record) => {
            const bookmark = bookmarks.find((candidate) => candidate.id === record.id);
            if (bookmark) void handleBookmarkPress(bookmark);
          },
          onOpenDetail: (record) => {
            const bookmark = bookmarks.find((candidate) => candidate.id === record.id);
            if (bookmark) openBookmarkDetail(bookmark);
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
