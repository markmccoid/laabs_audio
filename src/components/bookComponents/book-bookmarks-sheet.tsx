import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import { useGetItemDetails, useGetUserServerState } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";
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

type BookmarkMenuActionId = "play" | "detail" | "delete";

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
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
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

  const getBookmarkMenuActions = (
    bookmark: LocalBookmarkRecord,
    disabled: boolean,
  ): MenuAction[] => [
    {
      id: "play",
      title: "Play from Bookmark",
      image: "play.fill",
      attributes: { disabled },
    },
    {
      id: "detail",
      title: "Bookmark Details",
      image: "square.and.pencil",
      attributes: { disabled },
    },
    {
      id: "delete",
      title: "Delete Bookmark",
      image: "trash",
      attributes: { destructive: true, disabled },
    },
  ];

  const handleBookmarkMenuAction = (event: NativeActionEvent, bookmark: LocalBookmarkRecord) => {
    if (isBookmarkPlayPending) return;
    const actionId = event.nativeEvent.event as BookmarkMenuActionId;
    if (actionId === "play") {
      void handleBookmarkPress(bookmark);
      return;
    }
    if (actionId === "detail") {
      openBookmarkDetail(bookmark);
      return;
    }
    if (actionId === "delete") {
      openDeleteConfirm(bookmark);
    }
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

  const openDeleteConfirm = (bookmark: LocalBookmarkRecord) => {
    if (pendingDeleteId !== null || isBookmarkPlayPending) return;
    const timeLabel = getBookmarkTimeLabel(bookmark.startTimeSeconds);
    const title = getBookmarkDisplayTitle(bookmark);

    Alert.alert("Delete bookmark?", `Delete "${title}" at ${timeLabel}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void handleDeleteBookmark(bookmark);
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }} collapsable={false}>
      <Stack.Screen
        options={{
          // headerShown: true,
          title: "Bookmarks",
        }}
      />
      <View
        collapsable={false}
        style={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      >
        <View className="flex-row items-center justify-between">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text className="text-xl font-bold text-text">Bookmarks</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export bookmarks"
              onPress={openExportFormatPicker}
              disabled={isExporting || isBookmarkPlayPending}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed || isExporting || isBookmarkPlayPending ? 0.75 : 1,
              })}
            >
              <SymbolView
                name={isExporting ? "hourglass" : "square.and.arrow.up"}
                tintColor={themeColors.textMuted}
                size={15}
              />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close bookmarks"
            onPress={() => router.back()}
            disabled={isExporting || isBookmarkPlayPending}
            style={({ pressed }) => ({
              minWidth: 72,
              height: 34,
              borderRadius: 17,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 12,
              opacity: pressed || isExporting || isBookmarkPlayPending ? 0.75 : 1,
            })}
          >
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 13, fontWeight: "700" }}
            >
              Close
            </Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={libraryItemId ? bookmarks : []}
        keyExtractor={(bookmark) => bookmark.id}
        style={{ flex: 1 }}
        bounces={false}
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Math.max(24, insets.bottom + 12),
          gap: 10,
        }}
        renderItem={({ item: bookmark }) => {
          const timeLabel =
            bookmark.kind === "clip" && typeof bookmark.endTimeSeconds === "number"
              ? `${getBookmarkTimeLabel(bookmark.startTimeSeconds)} - ${getBookmarkTimeLabel(
                  bookmark.endTimeSeconds,
                )}`
              : getBookmarkTimeLabel(bookmark.startTimeSeconds);
          const title = getBookmarkDisplayTitle(bookmark);
          const note = bookmark.note?.trim() ?? "";
          const hasLocalNote = Boolean(note.length);
          const isPending = pendingBookmarkId === bookmark.id;
          const isDeleting = pendingDeleteId === bookmark.id;
          const isActionDisabled = isBookmarkPlayPending || isDeleting;
          const primaryActionLabel = `Open bookmark actions for ${title} at ${timeLabel}`;

          return (
            <MenuView
              title={title}
              actions={getBookmarkMenuActions(bookmark, isActionDisabled)}
              onPressAction={(event) => handleBookmarkMenuAction(event, bookmark)}
              style={{ flex: 1 }}
            >
              <View
                accessibilityRole="button"
                accessibilityLabel={primaryActionLabel}
                style={{
                  borderRadius: 14,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  opacity: isActionDisabled ? 0.8 : 1,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      borderCurve: "continuous",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: themeColors.bg,
                      borderWidth: 1,
                      borderColor: themeColors.border,
                    }}
                  >
                    <SymbolView name="bookmark.fill" tintColor={themeColors.accent} size={13} />
                  </View>
                  <View style={{ flex: 1, gap: 2, paddingRight: 10 }}>
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                    >
                      {title}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        selectable
                        style={{
                          color: themeColors.textMuted,
                          fontSize: 12,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {timeLabel}
                      </Text>
                      {hasLocalNote ? (
                        <View className="flex-row flex-1 mx-1">
                          <Text className="flex-1 text-xs" numberOfLines={1}>
                            {note}
                          </Text>
                        </View>
                      ) : null}
                      {bookmark.kind === "clip" || bookmark.serverLink.status !== "matched" ? (
                        <View
                          style={{
                            borderRadius: 999,
                            borderCurve: "continuous",
                            borderWidth: 1,
                            borderColor: themeColors.border,
                            backgroundColor: themeColors.bg,
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                          }}
                        >
                          <Text selectable style={{ color: themeColors.textMuted, fontSize: 10 }}>
                            {bookmark.serverLink.status !== "matched" ? "Unmatched" : "Clip"}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                <SymbolView
                  name={isPending || isDeleting ? "hourglass" : "ellipsis"}
                  tintColor={themeColors.textMuted}
                  size={14}
                />
              </View>
            </MenuView>
          );
        }}
        ListEmptyComponent={
          <View
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 14,
              paddingVertical: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              No Bookmarks
            </Text>
          </View>
        }
      />
    </View>
  );
};
