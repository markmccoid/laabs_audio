import { useResolvedListeningOwnerKey } from "@/auth/listening-owner";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService } from "@/player";
import { resolveClipExportAvailability, resolveClipExportSourcePlan } from "@/sharing/clip-export";
import {
  deleteClipExportFile,
  extractClipExportFile,
  getClipExportErrorMessage,
} from "@/sharing/clip-export-extractor";
import {
  createClipTranscriptExportFile,
  deleteClipTranscriptExportFile,
} from "@/sharing/clip-transcript-export";
import {
  useDeviceBooksActions,
  useDeviceBooksStore,
  type LocalBookmarkRecord,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  resolveClipTranscriptionAvailability,
  transcribeClipSourcePlan,
} from "@/transcription";
import {
  logClipTranscriptExportFailure,
  type ClipTranscriptExportStage,
} from "@/transcription/clip-transcript-export-log";
import type { Bookmark } from "@/types/absTypes";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
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

const getClipTranscriptExportErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return "Unable to export clip transcript";
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

export const BookBookmarkDetailSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const draft = useBookAddBookmarkDraft();
  const { addBookmark } = useDeviceBooksActions();
  const { libraryItemId: libraryItemIdParam, bookmarkId: bookmarkIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
    bookmarkId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const bookmarkId = resolveParam(bookmarkIdParam);
  const resolvedUserKey = useResolvedListeningOwnerKey(libraryItemId);
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
  const [isExportingTranscript, setIsExportingTranscript] = useState(false);
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
      itemDetails,
      range: {
        startTimeSeconds: bookmark.startTimeSeconds,
        endTimeSeconds: bookmark.endTimeSeconds,
      },
    });
  }, [bookmark, downloadInfo, itemDetails, libraryItemId]);
  const clipExportAvailability = useMemo(
    () =>
      resolveClipExportAvailability(savedClipExportPlan, {
        hasDownloadedAudio: Boolean(downloadInfo?.audioTracks.length),
      }),
    [downloadInfo?.audioTracks.length, savedClipExportPlan],
  );
  const clipTranscriptionAvailability = useMemo(
    () =>
      resolveClipTranscriptionAvailability(savedClipExportPlan, {
        hasDownloadedAudio: Boolean(downloadInfo?.audioTracks.length),
      }),
    [downloadInfo?.audioTracks.length, savedClipExportPlan],
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
  const clipTranscriptExportUnavailableReason = (() => {
    if (!bookmark || bookmark.kind !== "clip") return null;
    if (hasUnsavedChanges) return "Save changes before exporting";
    if (activeBookDownloadInProgress) return "Download is still finishing";
    if (Platform.OS !== "ios") return "Clip Transcription is unavailable on this platform";
    if (!clipTranscriptionAvailability.available) return clipTranscriptionAvailability.reason;
    return null;
  })();
  const canExportClip = Boolean(
    bookmark &&
      bookmark.kind === "clip" &&
      !hasUnsavedChanges &&
      !activeBookDownloadInProgress &&
      clipExportAvailability.available &&
      !isSaving &&
      !isExporting &&
      !isExportingTranscript,
  );
  const canExportClipTranscript = Boolean(
    bookmark &&
      bookmark.kind === "clip" &&
      !hasUnsavedChanges &&
      !activeBookDownloadInProgress &&
      Platform.OS === "ios" &&
      clipTranscriptionAvailability.available &&
      !isSaving &&
      !isExporting &&
      !isExportingTranscript,
  );
  const isBusy = isSaving || isExporting || isExportingTranscript;
  const canSave = Boolean(bookmark && draft.title.trim() && hasUnsavedChanges && !isBusy);
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
    router.push("/book-bookmark-detail/clip-editor");
  };

  const closeDetail = useCallback(async () => {
    await playerService.restoreListeningPositionAfterPreview();
    Keyboard.dismiss();
    router.back();
  }, []);

  const requestCloseDetail = useCallback(() => {
    if (isBusy) return;
    if (!hasUnsavedChanges) {
      void closeDetail();
      return;
    }

    Alert.alert("Discard changes?", "Your bookmark changes have not been saved.", [
      { text: "Keep Editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          void closeDetail();
        },
      },
    ]);
  }, [closeDetail, hasUnsavedChanges, isBusy]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      requestCloseDetail();
      return true;
    });

    return () => subscription.remove();
  }, [requestCloseDetail]);

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
        userKey: resolvedUserKey,
        localBookmarkId: bookmark.id,
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: isClipDraft ? draft.clipEndSeconds : null,
      });
      Keyboard.dismiss();
      toast.success(isClipDraft ? "Clip saved" : "Bookmark saved");
      router.back();
    } catch (error) {
      console.warn("[BookBookmarkDetailSheet] Failed to save bookmark draft", error);
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
      console.warn("[BookBookmarkDetailSheet] Failed to export clip", error);
      toast.error(getClipExportErrorMessage(error));
    } finally {
      setIsExporting(false);
      await deleteClipExportFile(exportFileUri);
    }
  };

  const handleExportTranscript = async () => {
    if (
      !bookmark ||
      !savedClipExportPlan ||
      !clipTranscriptionAvailability.available ||
      !canExportClipTranscript
    ) {
      if (clipTranscriptExportUnavailableReason) toast.info(clipTranscriptExportUnavailableReason);
      return;
    }

    let exportFileUri: string | null = null;
    let transcriptExportStage: ClipTranscriptExportStage = "unknown";
    setIsExportingTranscript(true);
    try {
      transcriptExportStage = "restore_listening_position";
      await playerService.restoreListeningPositionAfterPreview();
      transcriptExportStage = "transcribe_clip";
      const transcription = await transcribeClipSourcePlan({
        plan: savedClipExportPlan,
      });
      if (!transcription.text.trim()) {
        throw new Error("Clip Transcription did not return text");
      }

      transcriptExportStage = "create_export_file";
      const result = await createClipTranscriptExportFile({
        bookTitle,
        bookmarkTitle: bookmark.title,
        range: savedClipExportPlan.range,
        transcription,
      });
      exportFileUri = result.fileUri;

      transcriptExportStage = "check_sharing";
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        logClipTranscriptExportFailure({
          trigger: "book_bookmark_edit",
          libraryItemId,
          bookTitle,
          bookmarkId: bookmark.id,
          bookmarkTitle: bookmark.title,
          range: savedClipExportPlan.range,
          stage: transcriptExportStage,
          error: new Error("Sharing is not available on this device"),
        });
        toast.info("Sharing is not available on this device");
        return;
      }

      transcriptExportStage = "share_export_file";
      await Sharing.shareAsync(result.fileUri, {
        dialogTitle: "Export clip transcript",
        mimeType: result.mimeType,
        UTI: result.uti,
      });
    } catch (error) {
      console.warn("[BookBookmarkDetailSheet] Failed to export clip transcript", error);
      logClipTranscriptExportFailure({
        trigger: "book_bookmark_edit",
        libraryItemId,
        bookTitle,
        bookmarkId: bookmark.id,
        bookmarkTitle: bookmark.title,
        range: savedClipExportPlan.range,
        stage: transcriptExportStage,
        error,
      });
      toast.error(getClipTranscriptExportErrorMessage(error));
    } finally {
      setIsExportingTranscript(false);
      await deleteClipTranscriptExportFile(exportFileUri);
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
        <Stack.Screen options={{ title: isClipDraft ? "Clip Bookmark" : "Bookmark Detail" }} />

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
            {isClipDraft ? "Clip Bookmark" : "Bookmark Detail"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel bookmark detail"
            onPress={() => {
              requestCloseDetail();
            }}
            disabled={isBusy}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              alignItems: "center",
              justifyContent: "center",
              padding: 10,
              opacity: isBusy ? 0.5 : pressed ? 0.82 : 1,
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
                editable={!isBusy}
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
                  disabled={isBusy}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    backgroundColor: themeColors.accent,
                    paddingVertical: 12,
                    alignItems: "center",
                    opacity: isBusy ? 0.5 : pressed ? 0.82 : 1,
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
                    disabled={isBusy}
                    style={({ pressed }) => ({
                      flex: 1,
                      borderRadius: 12,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: themeColors.border,
                      backgroundColor: fieldBackgroundColor,
                      paddingVertical: 12,
                      alignItems: "center",
                      opacity: isBusy ? 0.5 : pressed ? 0.82 : 1,
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
              <View style={{ gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Export audio clip"
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
                    {isExporting ? "Exporting..." : "Export Audio Clip"}
                  </Text>
                </Pressable>
                {clipExportUnavailableReason ? (
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                    {clipExportUnavailableReason}
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Export clip transcript"
                  onPress={() => {
                    void handleExportTranscript();
                  }}
                  disabled={!canExportClipTranscript}
                  style={({ pressed }) => ({
                    borderRadius: 14,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: canExportClipTranscript ? themeColors.accent : themeColors.border,
                    backgroundColor: canExportClipTranscript
                      ? themeColors.accent
                      : themeColors.surface,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: !canExportClipTranscript ? 0.55 : pressed ? 0.82 : 1,
                  })}
                >
                  <SymbolView
                    name="doc.text"
                    tintColor={
                      canExportClipTranscript ? themeColors.accentForeground : themeColors.textMuted
                    }
                    size={16}
                  />
                  <Text
                    selectable
                    style={{
                      color: canExportClipTranscript
                        ? themeColors.accentForeground
                        : themeColors.textMuted,
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    {isExportingTranscript ? "Exporting..." : "Export Clip Transcript"}
                  </Text>
                </Pressable>
                {clipTranscriptExportUnavailableReason ? (
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                    {clipTranscriptExportUnavailableReason}
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
                editable={!isBusy}
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
