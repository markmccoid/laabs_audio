import { useAuthStore } from "@/auth/auth-store";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService, useClipPreviewStore } from "@/player";
import { useDeviceBooksActions, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import {
  resolveClipExportAvailability,
  resolveClipExportSourcePlan,
} from "@/sharing/clip-export";
import { deleteClipExportFile, extractClipExportFile } from "@/sharing/clip-export-extractor";
import { ClipRangeEditor } from "./clip-range-editor";
import { useClipRangeDraft } from "./use-clip-range-draft";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const getUserKey = (username: string | null, serverUrl: string | null) => {
  if (!username || !serverUrl) return null;
  return `${username}::${serverUrl}`;
};

export const BookClipDetailSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
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

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [shouldRenderPreviewTimer, setShouldRenderPreviewTimer] = useState(false);
  const previewTimerOpacity = useRef(new Animated.Value(0)).current;
  const previewTimerTranslateX = useRef(new Animated.Value(-6)).current;
  const previewStatus = useClipPreviewStore((state) => state.status);
  const previewBookmarkId = useClipPreviewStore((state) => state.bookmarkId);
  const previewPositionMs = useClipPreviewStore((state) => state.positionMs);

  useEffect(() => {
    if (!bookmark) return;
    setTitle(bookmark.title);
    setNote(bookmark.note?.trim() ?? "");
  }, [bookmark]);

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  const durationSeconds = itemDetails?.bookDuration ?? 0;
  const trimmedTitle = title.trim();
  const savedNote = bookmark?.note?.trim() ?? "";
  const savedEndSeconds =
    bookmark?.endTimeSeconds ?? (bookmark ? bookmark.startTimeSeconds + 30 : 0);
  const bookTitle = itemDetails?.title ?? itemDetails?.media?.metadata?.title ?? "Book";
  const isThisClipPreview =
    Boolean(bookmarkId) &&
    previewBookmarkId === bookmarkId &&
    previewStatus !== "idle" &&
    previewStatus !== "error";
  const isPreviewing = isThisClipPreview && previewStatus !== "ended";

  useEffect(() => {
    if (isPreviewing) {
      setShouldRenderPreviewTimer(true);
      Animated.parallel([
        Animated.timing(previewTimerOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(previewTimerTranslateX, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(previewTimerOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(previewTimerTranslateX, {
        toValue: -6,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setShouldRenderPreviewTimer(false);
      }
    });
  }, [isPreviewing, previewTimerOpacity, previewTimerTranslateX]);

  const handleDraftEditStart = useCallback(() => {
    if (!isPreviewing) return;
    void playerService.restoreListeningPositionAfterPreview();
  }, [isPreviewing]);
  const clipDraft = useClipRangeDraft({
    initialStartSeconds: bookmark?.startTimeSeconds ?? 0,
    initialEndSeconds: bookmark?.endTimeSeconds ?? (bookmark ? bookmark.startTimeSeconds + 30 : 30),
    bookDurationSeconds: durationSeconds,
    resetKey: bookmark
      ? `${bookmark.id}:${bookmark.startTimeSeconds}:${bookmark.endTimeSeconds ?? ""}:${durationSeconds}`
      : null,
    onEditStart: handleDraftEditStart,
  });
  const hasDirtyDraft = Boolean(
    bookmark &&
      (trimmedTitle !== bookmark.title.trim() ||
        note.trim() !== savedNote ||
        clipDraft.startSeconds !== bookmark.startTimeSeconds ||
        clipDraft.endSeconds !== savedEndSeconds),
  );
  const canSave = Boolean(
    bookmark &&
      libraryItemId &&
      trimmedTitle &&
      hasDirtyDraft &&
      !clipDraft.validationMessage &&
      !isSaving &&
      !isExporting,
  );
  const savedClipExportPlan = useMemo(() => {
    if (!bookmark || bookmark.kind !== "clip" || !libraryItemId) return null;
    return resolveClipExportSourcePlan({
      libraryItemId,
      downloadInfo,
      range: {
        startTimeSeconds: bookmark.startTimeSeconds,
        endTimeSeconds: savedEndSeconds,
      },
    });
  }, [bookmark, downloadInfo, libraryItemId, savedEndSeconds]);
  const clipExportAvailability = useMemo(
    () => resolveClipExportAvailability(savedClipExportPlan),
    [savedClipExportPlan],
  );
  const activeBookDownloadInProgress =
    Boolean(libraryItemId) && activeDownloadLibraryItemId === libraryItemId;
  const clipExportUnavailableReason = (() => {
    if (!bookmark || bookmark.kind !== "clip") return "Clip export is only available for clips";
    if (hasDirtyDraft) return "Save changes before exporting";
    if (activeBookDownloadInProgress) return "Download is still finishing";
    if (!clipExportAvailability.available) return clipExportAvailability.reason;
    return null;
  })();
  const canExportClip = Boolean(
    bookmark &&
      bookmark.kind === "clip" &&
      !hasDirtyDraft &&
      !activeBookDownloadInProgress &&
      clipExportAvailability.available &&
      !isSaving &&
      !isExporting,
  );
  const isBusy = isSaving || isExporting;
  const canPreviewClip = Boolean(
    bookmark && libraryItemId && !clipDraft.validationMessage && !isBusy,
  );
  const previewPositionSeconds = Math.max(
    clipDraft.startSeconds,
    Math.min(clipDraft.endSeconds, Math.round(previewPositionMs / 1000)),
  );
  const handlePreview = useCallback(async () => {
    if (!libraryItemId || clipDraft.validationMessage || !bookmark) return;
    try {
      if (isPreviewing) {
        await playerService.restoreListeningPositionAfterPreview();
        return;
      }
      await playerService.restoreListeningPositionAfterPreview();
      await playerService.playClipPreview({
        libraryItemId,
        bookmarkId: bookmark.id,
        startTimeSeconds: clipDraft.startSeconds,
        endTimeSeconds: clipDraft.endSeconds,
      });
    } catch (error) {
      console.warn("[BookClipDetailSheet] Failed to preview clip", error);
      toast.error("Unable to preview clip");
    }
  }, [
    bookmark,
    clipDraft.endSeconds,
    clipDraft.startSeconds,
    clipDraft.validationMessage,
    isPreviewing,
    libraryItemId,
  ]);
  const previewTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .enabled(canPreviewClip)
        .onEnd((_event, success) => {
          if (!success) return;
          void handlePreview();
        }),
    [canPreviewClip, handlePreview],
  );

  const handleSave = async () => {
    if (!bookmark || !libraryItemId || !canSave) return;
    const localNote = note.trim();
    const bookmarkPayload: Bookmark = {
      libraryItemId,
      time: clipDraft.startSeconds,
      title: trimmedTitle,
      createdAt: bookmark.createdAt,
    };

    setIsSaving(true);
    try {
      await addBookmark(libraryItemId, bookmarkPayload, {
        localBookmarkId: bookmark.id,
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: clipDraft.endSeconds,
      });
      Keyboard.dismiss();
      toast.success("Clip saved");
      router.back();
    } catch (error) {
      console.warn("[BookClipDetailSheet] Failed to save clip", error);
      toast.error("Unable to save clip");
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    if (
      !bookmark ||
      !savedClipExportPlan ||
      !clipExportAvailability.available ||
      !canExportClip
    ) {
      if (clipExportUnavailableReason) {
        toast.info(clipExportUnavailableReason);
      }
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
      console.warn("[BookClipDetailSheet] Failed to export clip", error);
      toast.error("Unable to export clip");
    } finally {
      setIsExporting(false);
      await deleteClipExportFile(exportFileUri);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ flex: 1 }}
        scrollEnabled={!isScrubbing}
        bounces={false}
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          flexGrow: 1,
          gap: 14,
          paddingHorizontal: 16,
          paddingTop: 30,
          paddingBottom: Math.max(24, insets.bottom + 12),
          backgroundColor: themeColors.bg,
        }}
      >
        <Stack.Screen options={{ title: "Clip Detail" }} />

      <View className="flex-row justify-between items-center">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to bookmarks"
            onPress={() => router.back()}
            disabled={isBusy}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              alignItems: "center",
              justifyContent: "center",
              opacity: isBusy ? 0.45 : pressed ? 0.8 : 1,
            })}
          >
            <SymbolView name="chevron.left" tintColor={themeColors.text} size={17} />
          </Pressable>
          <Text selectable style={{ color: themeColors.text, fontSize: 20, fontWeight: "700" }}>
            Clip Detail
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save clip"
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
            Clip bookmark not found.
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
              value={title}
              onChangeText={setTitle}
              editable={!isBusy}
              placeholder="Bookmark title"
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

          <ClipRangeEditor
            draft={clipDraft}
            bookDurationSeconds={durationSeconds}
            disabled={isBusy}
            onScrubbingChange={setIsScrubbing}
            rangeAccessory={
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: 10,
                }}
              >
                <GestureDetector gesture={previewTapGesture}>
                  <View
                    accessibilityRole="button"
                    accessibilityLabel={isPreviewing ? "Stop clip preview" : "Preview clip"}
                    accessibilityState={{ disabled: !canPreviewClip }}
                    onAccessibilityTap={() => {
                      if (!canPreviewClip) return;
                      void handlePreview();
                    }}
                    style={{
                      width: 80,
                      height: 40,
                      borderRadius: 20,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: themeColors.border,
                      backgroundColor: themeColors.surface,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: canPreviewClip ? 1 : 0.5,
                    }}
                  >
                    <SymbolView
                      name={isPreviewing ? "pause.fill" : "play.fill"}
                      tintColor={themeColors.accent}
                      size={17}
                    />
                  </View>
                </GestureDetector>
                {shouldRenderPreviewTimer ? (
                  <Animated.View
                    style={{
                      opacity: previewTimerOpacity,
                      transform: [{ translateX: previewTimerTranslateX }],
                    }}
                  >
                    <Text
                      selectable
                      style={{
                        color: themeColors.text,
                        fontSize: 18,
                        fontWeight: "700",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {formatSeconds(previewPositionSeconds, "compact", true, true)}
                    </Text>
                  </Animated.View>
                ) : null}
              </View>
            }
          />

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

          <View style={{ gap: 6 }}>
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
            >
              Local Note
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
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
                backgroundColor: themeColors.bg,
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
