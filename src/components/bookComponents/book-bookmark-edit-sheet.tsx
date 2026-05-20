import { useAuthStore } from "@/auth/auth-store";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService } from "@/player";
import { resolveClipExportAvailability, resolveClipExportSourcePlan } from "@/sharing/clip-export";
import { deleteClipExportFile, extractClipExportFile } from "@/sharing/clip-export-extractor";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import {
  formatBookmarkDraftDuration,
  formatBookmarkDraftTime,
  useBookAddBookmarkDraft,
} from "./book-addbookmark-draft-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getUserKey = (username: string | null, serverUrl: string | null) => {
  if (!username || !serverUrl) return null;
  return `${username}::${serverUrl}`;
};

const areDraftAndBookmarkEqual = (
  draft: ReturnType<typeof useBookAddBookmarkDraft>,
  bookmark: LocalBookmarkRecord,
) => {
  const draftKind = draft.kind === "clip" && draft.clipEndSeconds !== null ? "clip" : "point";
  return (
    draftKind === bookmark.kind &&
    draft.title.trim() === bookmark.title.trim() &&
    draft.localNote.trim() === (bookmark.note ?? "").trim() &&
    draft.positionSeconds === bookmark.startTimeSeconds &&
    (draftKind === "clip" ? draft.clipEndSeconds : null) ===
      (bookmark.kind === "clip" ? (bookmark.endTimeSeconds ?? null) : null)
  );
};

export const BookBookmarkEditSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const draft = useBookAddBookmarkDraft();
  const { addBookmark } = useDeviceBooksActions();
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const { libraryItemId: libraryItemIdParam, bookmarkId: bookmarkIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
    bookmarkId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const bookmarkId = resolveParam(bookmarkIdParam);
  const resolvedUserKey = useMemo(
    () => activeLibraryUserKey ?? getUserKey(storedUsername, serverUrl),
    [activeLibraryUserKey, serverUrl, storedUsername],
  );
  const bookmark = useDeviceBooksStore((state) =>
    resolvedUserKey && bookmarkId
      ? state.localBookmarksByUser[resolvedUserKey]?.[bookmarkId]
      : null,
  );
  const downloadInfo = useDeviceBooksStore((state) =>
    libraryItemId ? state.downloadedBookData[libraryItemId] : undefined,
  );
  const activeDownloadLibraryItemId = useDeviceBooksStore(
    (state) => state.activeDownloadSession?.libraryItemId,
  );
  const { data: itemDetails } = useGetItemDetails(libraryItemId);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const seededBookmarkIdRef = useRef<string | null>(null);
  const isClipDraft = draft.kind === "clip" && draft.clipEndSeconds !== null;
  const hasUnsavedChanges = Boolean(bookmark && !areDraftAndBookmarkEqual(draft, bookmark));
  const clipDurationSeconds = isClipDraft
    ? Math.max(0, (draft.clipEndSeconds ?? draft.positionSeconds) - draft.positionSeconds)
    : 0;
  const bookTitle = itemDetails?.title ?? itemDetails?.media?.metadata?.title ?? "Book";
  const savedClipExportPlan = useMemo(() => {
    if (!bookmark || bookmark.kind !== "clip" || !libraryItemId || !bookmark.endTimeSeconds) {
      return null;
    }
    return resolveClipExportSourcePlan({
      libraryItemId,
      downloadInfo,
      range: {
        startTimeSeconds: bookmark.startTimeSeconds,
        endTimeSeconds: bookmark.endTimeSeconds,
      },
    });
  }, [bookmark, downloadInfo, libraryItemId]);
  const clipExportAvailability = useMemo(
    () => resolveClipExportAvailability(savedClipExportPlan),
    [savedClipExportPlan],
  );
  const activeBookDownloadInProgress =
    Boolean(libraryItemId) && activeDownloadLibraryItemId === libraryItemId;
  const clipExportUnavailableReason = (() => {
    if (!bookmark || bookmark.kind !== "clip") return null;
    if (hasUnsavedChanges) return "Save changes before exporting";
    if (activeBookDownloadInProgress) return "Download is still finishing";
    if (!clipExportAvailability.available) return clipExportAvailability.reason;
    return null;
  })();
  const canExportClip = Boolean(
    bookmark &&
      bookmark.kind === "clip" &&
      !hasUnsavedChanges &&
      !activeBookDownloadInProgress &&
      clipExportAvailability.available &&
      !isSaving &&
      !isExporting,
  );
  const canSave = Boolean(bookmark && draft.title.trim() && hasUnsavedChanges && !isSaving);
  const fieldBackgroundColor = "#FFFFFF";

  useEffect(() => {
    if (!bookmark || seededBookmarkIdRef.current === bookmark.id) return;
    draft.seedFromBookmark(bookmark);
    seededBookmarkIdRef.current = bookmark.id;
  }, [bookmark, draft]);

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  const openClipEditor = () => {
    if (!bookmark) return;
    draft.convertToClipDraft();
    router.push("/book-bookmarks/clip-editor");
  };

  const closeDraft = async () => {
    await playerService.restoreListeningPositionAfterPreview();
    Keyboard.dismiss();
    router.back();
  };

  const handleSave = async () => {
    if (!bookmark || !libraryItemId || !canSave) return;
    const localNote = draft.localNote.trim();
    const bookmarkPayload: Bookmark = {
      libraryItemId,
      time: draft.positionSeconds,
      title: draft.title.trim(),
      createdAt: bookmark.createdAt,
      ...(localNote.length > 0 ? { notes: localNote } : {}),
    };

    setIsSaving(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      await addBookmark(libraryItemId, bookmarkPayload, {
        localBookmarkId: bookmark.id,
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: isClipDraft ? draft.clipEndSeconds : null,
      });
      Keyboard.dismiss();
      toast.success(isClipDraft ? "Clip saved" : "Bookmark saved");
      router.back();
    } catch (error) {
      console.warn("[BookBookmarkEditSheet] Failed to save bookmark draft", error);
      toast.error("Unable to save bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    if (!bookmark || !savedClipExportPlan || !clipExportAvailability.available || !canExportClip) {
      if (clipExportUnavailableReason) toast.info(clipExportUnavailableReason);
      return;
    }

    let exportFileUri: string | null = null;
    setIsExporting(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      const result = await extractClipExportFile({
        plan: savedClipExportPlan,
        bookTitle,
        bookmarkTitle: bookmark.title,
        outputFormat: clipExportAvailability.outputFormat,
      });
      exportFileUri = result.fileUri;

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        toast.info("Sharing is not available on this device");
        return;
      }

      await Sharing.shareAsync(result.fileUri, {
        dialogTitle: "Export clip",
        mimeType: result.mimeType,
        UTI: result.uti,
      });
    } catch (error) {
      console.warn("[BookBookmarkEditSheet] Failed to export clip", error);
      toast.error("Unable to export clip");
    } finally {
      setIsExporting(false);
      await deleteClipExportFile(exportFileUri);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      behavior={Platform.OS === "ios" ? "height" : "height"}
    >
      <ScrollView
        style={{ flex: 1 }}
        bounces={false}
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          flexGrow: 1,
          gap: 14,
          paddingHorizontal: 16,
          paddingTop: Math.max(30, insets.top + 16),
          paddingBottom: Math.max(24, insets.bottom + 12),
          backgroundColor: themeColors.bg,
        }}
      >
        <Stack.Screen options={{ title: isClipDraft ? "Edit Clip" : "Edit Bookmark" }} />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text
            selectable
            style={{
              flex: 1,
              color: themeColors.text,
              fontSize: 20,
              lineHeight: 26,
              fontWeight: "700",
            }}
          >
            {isClipDraft ? "Edit Clip" : "Edit Bookmark"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel bookmark edit"
            onPress={() => {
              void closeDraft();
            }}
            disabled={isSaving || isExporting}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              alignItems: "center",
              justifyContent: "center",
              padding: 10,
              opacity: isSaving || isExporting ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save bookmark edit"
            onPress={() => {
              void handleSave();
            }}
            disabled={!canSave}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.accent,
              backgroundColor: themeColors.accent,
              alignItems: "center",
              justifyContent: "center",
              padding: 10,
              opacity: !canSave ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <Text
              selectable
              style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "700" }}
            >
              {isSaving ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>

        {!bookmark ? (
          <View
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              padding: 14,
            }}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              Bookmark not found.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <Text
                selectable
                style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
              >
                Bookmark Title
              </Text>
              <TextInput
                value={draft.title}
                onChangeText={draft.setTitle}
                editable={!isSaving && !isExporting}
                placeholder="Enter a descriptive name"
                placeholderTextColor={themeColors.textMuted}
                style={{
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: fieldBackgroundColor,
                  color: themeColors.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 14,
                }}
              />
            </View>

            <View
              style={{
                borderRadius: 14,
                borderCurve: "continuous",
                borderWidth: 1.5,
                borderColor: themeColors.accent,
                backgroundColor: themeColors.surface,
                padding: 12,
                gap: 12,
              }}
            >
              {isClipDraft ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      selectable
                      style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}
                    >
                      Clip Range
                    </Text>
                    <Text
                      selectable
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={{
                        color: themeColors.text,
                        fontSize: 18,
                        fontWeight: "800",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {formatBookmarkDraftTime(draft.positionSeconds)}
                      {" -> "}
                      {formatBookmarkDraftTime(draft.clipEndSeconds ?? draft.positionSeconds)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text
                      selectable
                      style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}
                    >
                      Duration
                    </Text>
                    <Text
                      selectable
                      style={{ color: themeColors.text, fontSize: 15, fontWeight: "800" }}
                    >
                      {formatBookmarkDraftDuration(clipDurationSeconds)}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={{ gap: 4 }}>
                  <Text
                    selectable
                    style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}
                  >
                    Position
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: themeColors.text,
                      fontSize: 18,
                      fontWeight: "800",
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatBookmarkDraftTime(draft.positionSeconds)}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isClipDraft ? "Edit clip range" : "Create clip"}
                  onPress={openClipEditor}
                  disabled={isSaving || isExporting}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    backgroundColor: themeColors.accent,
                    paddingVertical: 12,
                    alignItems: "center",
                    opacity: isSaving || isExporting ? 0.5 : pressed ? 0.82 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      color: themeColors.accentForeground,
                      fontSize: 14,
                      fontWeight: "800",
                    }}
                  >
                    {isClipDraft ? "Edit Clip" : "Create Clip"}
                  </Text>
                </Pressable>
                {isClipDraft ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove clip"
                    onPress={draft.removeClip}
                    disabled={isSaving || isExporting}
                    style={({ pressed }) => ({
                      flex: 1,
                      borderRadius: 12,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: themeColors.border,
                      backgroundColor: fieldBackgroundColor,
                      paddingVertical: 12,
                      alignItems: "center",
                      opacity: isSaving || isExporting ? 0.5 : pressed ? 0.82 : 1,
                    })}
                  >
                    <Text
                      selectable
                      style={{ color: themeColors.text, fontSize: 14, fontWeight: "800" }}
                    >
                      Remove Clip
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {bookmark.kind === "clip" ? (
              <View style={{ gap: 6 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Export clip"
                  onPress={() => {
                    void handleExport();
                  }}
                  disabled={!canExportClip}
                  style={({ pressed }) => ({
                    borderRadius: 14,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: canExportClip ? themeColors.accent : themeColors.border,
                    backgroundColor: canExportClip ? themeColors.accent : themeColors.surface,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: !canExportClip ? 0.55 : pressed ? 0.82 : 1,
                  })}
                >
                  <SymbolView
                    name="square.and.arrow.up"
                    tintColor={canExportClip ? themeColors.accentForeground : themeColors.textMuted}
                    size={16}
                  />
                  <Text
                    selectable
                    style={{
                      color: canExportClip ? themeColors.accentForeground : themeColors.textMuted,
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    {isExporting ? "Exporting..." : "Export Clip"}
                  </Text>
                </Pressable>
                {clipExportUnavailableReason ? (
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                    {clipExportUnavailableReason}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text
                selectable
                style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
              >
                Local Note
              </Text>
              <TextInput
                value={draft.localNote}
                onChangeText={draft.setLocalNote}
                editable={!isSaving && !isExporting}
                placeholder="Add an optional note"
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                style={{
                  minHeight: 100,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: fieldBackgroundColor,
                  color: themeColors.text,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 14,
                }}
              />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
