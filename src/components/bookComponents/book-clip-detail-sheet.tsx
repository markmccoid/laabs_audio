import { useAuthStore } from "@/auth/auth-store";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService, useClipPreviewStore } from "@/player";
import { useDeviceBooksActions, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
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
  const { data: itemDetails } = useGetItemDetails(libraryItemId);

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
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
  const isThisClipPreview =
    Boolean(bookmarkId) &&
    previewBookmarkId === bookmarkId &&
    previewStatus !== "idle" &&
    previewStatus !== "error";
  const isPreviewing = isThisClipPreview && previewStatus !== "ended";
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
      !isSaving,
  );
  const previewPositionSeconds = Math.max(
    clipDraft.startSeconds,
    Math.min(clipDraft.endSeconds, Math.round(previewPositionMs / 1000)),
  );
  const previewButtonLabel = isThisClipPreview
    ? previewStatus === "loading"
      ? "Loading..."
      : isPreviewing
        ? "Stop Preview"
        : "Preview Clip"
    : "Preview Clip";
  const handlePreview = async () => {
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
  };

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

  return (
    <ScrollView
      style={{ flex: 1 }}
      scrollEnabled={!isScrubbing}
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
            disabled={isSaving}
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
              opacity: isSaving ? 0.45 : pressed ? 0.8 : 1,
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
              editable={!isSaving}
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
            disabled={isSaving}
            onScrubbingChange={setIsScrubbing}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPreviewing ? "Stop clip preview" : "Preview clip"}
            onPress={() => {
              void handlePreview();
            }}
            disabled={Boolean(clipDraft.validationMessage)}
            style={({ pressed }) => ({
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 14,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: clipDraft.validationMessage ? 0.5 : pressed ? 0.8 : 1,
            })}
          >
            <SymbolView
              name={isPreviewing ? "pause.fill" : "play.fill"}
              tintColor={themeColors.accent}
              size={16}
            />
            <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
              {previewButtonLabel}
            </Text>
          </Pressable>

          {isThisClipPreview ? (
            <Text
              selectable
              style={{
                color: themeColors.text,
                fontSize: 16,
                fontWeight: "700",
                textAlign: "center",
                fontVariant: ["tabular-nums"],
              }}
            >
              Preview Position: {formatSeconds(previewPositionSeconds, "compact", true, true)}
            </Text>
          ) : null}

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
              editable={!isSaving}
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
  );
};
