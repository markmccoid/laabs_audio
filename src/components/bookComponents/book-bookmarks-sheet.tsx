import { useAuthStore } from "@/auth/auth-store";
import { useGetItemDetails, useGetUserServerState } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import { useDeviceBooksActions, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import * as FileSystem from "expo-file-system/legacy";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
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
  positionSeconds: number;
  bookmarkName: string;
  notes: string;
};

const toBookmarksCsv = (rows: BookmarkExportRow[]) => {
  const header = ["libraryItemId", "bookName", "positionSeconds", "bookmarkName", "notes"];
  const lines = rows.map((row) =>
    [
      toCsvField(row.libraryItemId),
      toCsvField(row.bookName),
      toCsvField(row.positionSeconds),
      toCsvField(row.bookmarkName),
      toCsvField(row.notes),
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
  const bookmarkNotesByUserBookTime = useDeviceBooksStore(
    (state) => state.bookmarkNotesByUserBookTime,
  );
  const { addBookmark, setBookmarkLocalNote } = useDeviceBooksActions();
  const { data: userServerState } = useGetUserServerState();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const { data: itemDetails } = useGetItemDetails(libraryItemId);
  const bookName = itemDetails?.title ?? itemDetails?.media?.metadata?.title ?? "";
  const [pendingBookmarkTime, setPendingBookmarkTime] = useState<number | null>(null);
  const [bookmarkTitleOverrides, setBookmarkTitleOverrides] = useState<Record<string, string>>({});
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const bookmarks = useMemo(() => {
    const bookmarksByLibraryItemId =
      userServerState?.bookmarksByLibraryItemId ??
      (
        userServerState as typeof userServerState & {
          bookmarksByBookId?: Record<string, Bookmark[]>;
        }
      )?.bookmarksByBookId ??
      {};
    const libraryBookmarks = libraryItemId ? (bookmarksByLibraryItemId[libraryItemId] ?? []) : [];
    return [...libraryBookmarks].sort((a, b) => a.time - b.time);
  }, [libraryItemId, userServerState]);

  const resolvedUserKey = useMemo(
    () => activeLibraryUserKey ?? getUserKey(storedUsername, serverUrl),
    [activeLibraryUserKey, serverUrl, storedUsername],
  );

  const localNotesByBookmarkTime = useMemo(() => {
    if (!libraryItemId || !resolvedUserKey) return {};
    const notesByTime: Record<string, string> = {};
    bookmarks.forEach((bookmark) => {
      const key = `${resolvedUserKey}::${libraryItemId}::${bookmark.time}`;
      const note = bookmarkNotesByUserBookTime[key]?.trim() ?? "";
      if (!note) return;
      notesByTime[String(bookmark.time)] = note;
    });
    return notesByTime;
  }, [bookmarkNotesByUserBookTime, bookmarks, libraryItemId, resolvedUserKey]);

  const getBookmarkDisplayTitle = (bookmark: Bookmark) => {
    const overriddenTitle = bookmarkTitleOverrides[String(bookmark.time)]?.trim();
    if (overriddenTitle) {
      return overriddenTitle;
    }
    const bookmarkTitle = bookmark.title?.trim();
    if (bookmarkTitle) {
      return bookmarkTitle;
    }
    return `Bookmark ${getBookmarkTimeLabel(bookmark.time)}`;
  };

  const buildExportRows = (): BookmarkExportRow[] => {
    if (!libraryItemId) return [];
    return bookmarks.map((bookmark) => ({
      libraryItemId,
      bookName,
      positionSeconds: bookmark.time,
      bookmarkName: getBookmarkDisplayTitle(bookmark),
      notes: localNotesByBookmarkTime[String(bookmark.time)] ?? "",
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

  const openEditModal = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
    setEditingTitle(getBookmarkDisplayTitle(bookmark));
    setEditingNote(localNotesByBookmarkTime[String(bookmark.time)] ?? "");
  };

  const closeEditModal = () => {
    if (isSavingEdit) return;
    resetEditState();
  };

  const handleBookmarkPress = async (bookmark: Bookmark) => {
    if (!libraryItemId) return;
    const targetPositionMs = secondsToMs(bookmark.time);
    const isViewedBookActive = activeLibraryItemId === libraryItemId && queueLength > 0;
    const isViewedBookPlaying = isViewedBookActive && playbackState === "playing";

    setPendingBookmarkTime(bookmark.time);
    try {
      if (isViewedBookPlaying) {
        await playerService.seekTo(targetPositionMs);
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
      setPendingBookmarkTime(null);
      router.back();
    }
  };

  const handleSaveEdit = async () => {
    if (!editingBookmark || !libraryItemId || isSavingEdit) return;
    const fallbackTitle = `Bookmark ${getBookmarkTimeLabel(editingBookmark.time)}`;
    const nextTitle = editingTitle.trim() || fallbackTitle;
    const nextNote = editingNote.trim();
    const currentTitle = getBookmarkDisplayTitle(editingBookmark);
    const currentNote = (localNotesByBookmarkTime[String(editingBookmark.time)] ?? "").trim();
    const titleChanged = nextTitle !== currentTitle;
    const noteChanged = nextNote !== currentNote;

    if (!titleChanged && !noteChanged) {
      resetEditState();
      return;
    }

    setIsSavingEdit(true);
    try {
      if (titleChanged) {
        await addBookmark(
          libraryItemId,
          {
            ...editingBookmark,
            title: nextTitle,
          },
          { localNote: nextNote },
        );
        setBookmarkTitleOverrides((previous) => ({
          ...previous,
          [String(editingBookmark.time)]: nextTitle,
        }));
      } else if (noteChanged) {
        setBookmarkLocalNote(
          libraryItemId,
          editingBookmark.time,
          nextNote.length > 0 ? nextNote : null,
        );
      }
      resetEditState();
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed to save bookmark edits", error);
    } finally {
      setIsSavingEdit(false);
    }
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
        keyExtractor={(bookmark) =>
          `${bookmark.libraryItemId}-${bookmark.time}-${bookmark.createdAt}`
        }
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Math.max(24, insets.bottom + 12),
          gap: 10,
        }}
        renderItem={({ item: bookmark }) => {
          const timeLabel = getBookmarkTimeLabel(bookmark.time);
          const title = getBookmarkDisplayTitle(bookmark);
          const hasLocalNote = Boolean(localNotesByBookmarkTime[String(bookmark.time)]?.length);
          const isPending = pendingBookmarkTime === bookmark.time;

          return (
            <View style={{ flexDirection: "row", alignItems: "stretch", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Go to bookmark at ${timeLabel}`}
                onPress={() => {
                  void handleBookmarkPress(bookmark);
                }}
                disabled={isPending}
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
                  opacity: pressed || isPending ? 0.8 : 1,
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
                            {localNotesByBookmarkTime[String(bookmark.time)]}
                          </Text>
                        </View>
                      ) : // <View
                      //   style={{
                      //     flexDirection: "row",
                      //     alignItems: "center",
                      //     gap: 4,
                      //     borderRadius: 999,
                      //     borderCurve: "continuous",
                      //     borderWidth: 1,
                      //     borderColor: themeColors.border,
                      //     backgroundColor: themeColors.bg,
                      //     paddingHorizontal: 7,
                      //     paddingVertical: 2,
                      //   }}
                      // >
                      //   <SymbolView
                      //     name="note.text"
                      //     tintColor={themeColors.textMuted}
                      //     size={10}
                      //   />
                      //   <Text selectable style={{ color: themeColors.textMuted, fontSize: 10 }}>
                      //     Note
                      //   </Text>
                      // </View>
                      null}
                    </View>
                  </View>
                </View>
                <SymbolView
                  name={isPending ? "hourglass" : "play.fill"}
                  tintColor={themeColors.textMuted}
                  size={14}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit bookmark at ${timeLabel}`}
                onPress={() => openEditModal(bookmark)}
                disabled={isPending}
                style={({ pressed }) => ({
                  width: 44,
                  borderRadius: 14,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed || isPending ? 0.8 : 1,
                })}
              >
                <SymbolView name="square.and.pencil" tintColor={themeColors.textMuted} size={16} />
              </Pressable>
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
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(2, 6, 23, 0.45)",
            justifyContent: "center",
            paddingHorizontal: 18,
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
              borderRadius: 18,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              padding: 16,
              gap: 12,
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 18, fontWeight: "700" }}>
              Edit Bookmark
            </Text>

            <View style={{ gap: 6 }}>
              <Text
                selectable
                style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
              >
                Bookmark Name
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
                <Text selectable style={{ color: "#ffffff", fontSize: 13, fontWeight: "700" }}>
                  {isSavingEdit ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};
