import { useAuthStore } from "@/auth/auth-store";
import { useGetItemDetails, useGetUserServerState } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";
const getUserKey = (username: string | null, serverUrl: string | null) => {
  if (!username || !serverUrl) return null;
  return `${username}::${serverUrl}`;
};
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
  serverStatus: string;
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
    "serverStatus",
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
      toCsvField(row.serverStatus),
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
};

export const BookBookmarksSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const { addBookmark, deleteBookmark } = useDeviceBooksActions();
  useGetUserServerState();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const { data: itemDetails } = useGetItemDetails(libraryItemId);
  const bookName = itemDetails?.title ?? itemDetails?.media?.metadata?.title ?? "";
  const [pendingBookmarkId, setPendingBookmarkId] = useState<string | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<LocalBookmarkRecord | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const resolvedUserKey = useMemo(
    () => activeLibraryUserKey ?? getUserKey(storedUsername, serverUrl),
    [activeLibraryUserKey, serverUrl, storedUsername],
  );

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
      serverStatus: bookmark.serverLink.status,
    }));
  };

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
        format === "json" ? JSON.stringify(rows, null, 2) : toBookmarksCsv(rows);

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
    if (isExporting) return;
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

  const resetEditState = () => {
    setEditingBookmark(null);
    setEditingTitle("");
    setEditingNote("");
  };

  const openEditModal = (bookmark: LocalBookmarkRecord) => {
    setEditingBookmark(bookmark);
    setEditingTitle(getBookmarkDisplayTitle(bookmark));
    setEditingNote(bookmark.note?.trim() ?? "");
  };

  const closeEditModal = () => {
    if (isSavingEdit) return;
    resetEditState();
  };

  const handleBookmarkPress = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId) return;
    const targetPositionMs = secondsToMs(bookmark.startTimeSeconds);
    const isViewedBookActive = activeLibraryItemId === libraryItemId && queueLength > 0;
    const isViewedBookPlaying = isViewedBookActive && playbackState === "playing";

    setPendingBookmarkId(bookmark.id);
    try {
      await playerService.cancelPreviewForExplicitNavigation();
      if (isViewedBookPlaying) {
        await playerService.seekTo(targetPositionMs);
        await playerService.play({ touchProgressCache: false });
      } else if (isViewedBookActive) {
        await playerService.seekTo(targetPositionMs);
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

  const openSecondaryAction = (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId) return;
    if (bookmark.kind === "clip") {
      router.push({
        pathname: "/book-bookmarks/clip-detail",
        params: {
          libraryItemId,
          bookmarkId: bookmark.id,
        },
      });
      return;
    }
    openEditModal(bookmark);
  };

  const handleSaveEdit = async () => {
    if (!editingBookmark || !libraryItemId || isSavingEdit) return;
    const nextTitle = editingTitle.trim();
    if (!nextTitle) return;
    const nextNote = editingNote.trim();
    const currentTitle = getBookmarkDisplayTitle(editingBookmark);
    const currentNote = (editingBookmark.note ?? "").trim();
    const titleChanged = nextTitle !== currentTitle;
    const noteChanged = nextNote !== currentNote;

    if (!titleChanged && !noteChanged) {
      resetEditState();
      return;
    }

    setIsSavingEdit(true);
    try {
      await addBookmark(
        libraryItemId,
        {
          libraryItemId,
          time: editingBookmark.startTimeSeconds,
          title: nextTitle,
          createdAt: editingBookmark.createdAt,
        },
        {
          localBookmarkId: editingBookmark.id,
          localNote: nextNote.length > 0 ? nextNote : null,
          endTimeSeconds:
            editingBookmark.kind === "clip" ? (editingBookmark.endTimeSeconds ?? null) : null,
        },
      );
      resetEditState();
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed to save bookmark edits", error);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteBookmark = async (bookmark: LocalBookmarkRecord) => {
    if (!libraryItemId || pendingDeleteId !== null) return;

    setPendingDeleteId(bookmark.id);
    try {
      await deleteBookmark(libraryItemId, bookmark.startTimeSeconds, {
        localBookmarkId: bookmark.id,
      });
      toast.success("Bookmark deleted");
      if (editingBookmark?.id === bookmark.id) {
        resetEditState();
      }
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed to delete bookmark", error);
      toast.error("Unable to delete bookmark");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const openDeleteConfirm = (bookmark: LocalBookmarkRecord) => {
    if (pendingDeleteId !== null) return;
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
    <>
      <View className="px-8 pt-8" collapsable={false}>
        <Stack.Screen options={{ title: "Bookmarks" }} />
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-text">Bookmarks</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export bookmarks"
            onPress={openExportFormatPicker}
            disabled={isExporting}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: 17,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed || isExporting ? 0.75 : 1,
            })}
          >
            <SymbolView
              name={isExporting ? "hourglass" : "square.and.arrow.up"}
              tintColor={themeColors.textMuted}
              size={15}
            />
          </Pressable>
        </View>
      </View>
      <FlatList
        data={libraryItemId ? bookmarks : []}
        keyExtractor={(bookmark) => bookmark.id}
        style={{ flex: 1 }}
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
          const isActionDisabled = isPending || isDeleting;
          const primaryActionLabel = `Go to bookmark at ${timeLabel}`;
          const secondaryActionLabel =
            bookmark.kind === "clip"
              ? `View clip detail at ${timeLabel}`
              : `Edit bookmark at ${timeLabel}`;

          return (
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={primaryActionLabel}
                onPress={() => {
                  void handleBookmarkPress(bookmark);
                }}
                disabled={isActionDisabled}
                style={({ pressed }) => ({
                  flex: 1,
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
                  opacity: pressed || isActionDisabled ? 0.8 : 1,
                })}
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
                  name={isPending || isDeleting ? "hourglass" : "arrow.right"}
                  tintColor={themeColors.textMuted}
                  size={14}
                />
              </Pressable>

              <View style={{ width: 44, gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={secondaryActionLabel}
                  onPress={() => openSecondaryAction(bookmark)}
                  disabled={isActionDisabled}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed || isActionDisabled ? 0.8 : 1,
                  })}
                >
                  <SymbolView
                    name={bookmark.kind === "clip" ? "slider.horizontal.3" : "square.and.pencil"}
                    tintColor={themeColors.textMuted}
                    size={15}
                  />
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete bookmark at ${timeLabel}`}
                  onPress={() => openDeleteConfirm(bookmark)}
                  disabled={isActionDisabled}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed || isActionDisabled ? 0.8 : 1,
                  })}
                >
                  <SymbolView name={isDeleting ? "hourglass" : "trash"} tintColor="#dc2626" size={15} />
                </Pressable>
              </View>
            </View>
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

      <Modal
        transparent
        visible={Boolean(editingBookmark)}
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(2, 6, 23, 0.45)",
              justifyContent: "center",
              paddingHorizontal: 18,
              paddingVertical: 24,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close bookmark editor"
              onPress={closeEditModal}
              style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            />
            <View
              style={{
                maxHeight: "85%",
                borderRadius: 18,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                padding: 16,
                gap: 12,
              }}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 12 }}
                showsVerticalScrollIndicator={false}
              >
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}
                >
                  Edit Bookmark
                </Text>

                <View style={{ gap: 6 }}>
                  <Text
                    selectable
                    style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
                  >
                    Bookmark Title
                  </Text>
                  <TextInput
                    value={editingTitle}
                    onChangeText={setEditingTitle}
                    editable={!isSavingEdit}
                    placeholder="Bookmark name"
                    placeholderTextColor={themeColors.textMuted}
                    style={{
                      borderRadius: 12,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: themeColors.border,
                      backgroundColor: themeColors.bg,
                      color: themeColors.text,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 14,
                    }}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text
                    selectable
                    style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
                  >
                    Bookmark Note
                  </Text>
                  <TextInput
                    value={editingNote}
                    onChangeText={setEditingNote}
                    editable={!isSavingEdit}
                    placeholder="Add a local note"
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                    textAlignVertical="top"
                    style={{
                      minHeight: 96,
                      borderRadius: 12,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: themeColors.border,
                      backgroundColor: themeColors.bg,
                      color: themeColors.text,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 14,
                    }}
                  />
                </View>
              </ScrollView>

              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel edit bookmark"
                  onPress={closeEditModal}
                  disabled={isSavingEdit}
                  style={({ pressed }) => ({
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    opacity: pressed || isSavingEdit ? 0.8 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{ color: themeColors.text, fontSize: 13, fontWeight: "600" }}
                  >
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save bookmark changes"
                  onPress={() => {
                    void handleSaveEdit();
                  }}
                  disabled={isSavingEdit}
                  style={({ pressed }) => ({
                    borderRadius: 10,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.accent,
                    backgroundColor: themeColors.accent,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    opacity: pressed || isSavingEdit ? 0.82 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      color: themeColors.accentForeground,
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                  >
                    {isSavingEdit ? "Saving..." : "Save"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};
