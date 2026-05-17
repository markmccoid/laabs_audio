import { useAuthStore } from "@/auth/auth-store";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService, useClipPreviewStore } from "@/player";
import { useDeviceBooksActions, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import { ClipRangeScrubber } from "./clip-range-scrubber";
import {
  clampSeconds,
  getTrimWindowDurationSeconds,
  getTrimWindowStartForClip,
  MAX_CLIP_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
} from "./clip-timing";
import { ClipTrimWindowSlider } from "./clip-trim-window-slider";

const STEP_SECONDS = 5;

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
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [trimWindowStartSeconds, setTrimWindowStartSeconds] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const trimWindowDragStartRef = useRef({
    trimWindowStartSeconds: 0,
    startSeconds: 0,
    endSeconds: 0,
  });
  const previewStatus = useClipPreviewStore((state) => state.status);
  const previewBookmarkId = useClipPreviewStore((state) => state.bookmarkId);
  const previewPositionMs = useClipPreviewStore((state) => state.positionMs);

  useEffect(() => {
    if (!bookmark) return;
    setTitle(bookmark.title);
    setNote(bookmark.note?.trim() ?? "");
    setStartSeconds(bookmark.startTimeSeconds);
    setEndSeconds(bookmark.endTimeSeconds ?? bookmark.startTimeSeconds + 30);
    setTrimWindowStartSeconds(
      getTrimWindowStartForClip({
        startSeconds: bookmark.startTimeSeconds,
        endSeconds: bookmark.endTimeSeconds ?? bookmark.startTimeSeconds + 30,
        bookDurationSeconds: itemDetails?.bookDuration ?? 0,
      }),
    );
  }, [bookmark, itemDetails?.bookDuration]);

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  const durationSeconds = itemDetails?.bookDuration ?? 0;
  const trimWindowDurationSeconds = getTrimWindowDurationSeconds(durationSeconds);
  const trimWindowEndSeconds = trimWindowStartSeconds + trimWindowDurationSeconds;
  const clipDurationSeconds = endSeconds - startSeconds;
  const validationMessage =
    clipDurationSeconds < MIN_CLIP_DURATION_SECONDS
      ? "Clip end must be after start."
      : clipDurationSeconds > MAX_CLIP_DURATION_SECONDS
        ? "Clip cannot be longer than 5 minutes."
        : startSeconds < trimWindowStartSeconds || endSeconds > trimWindowEndSeconds
          ? "Clip range must fit inside the trim window."
        : durationSeconds > 0 && endSeconds > durationSeconds
          ? "Clip end cannot be past the end of the book."
          : null;
  const trimmedTitle = title.trim();
  const savedNote = bookmark?.note?.trim() ?? "";
  const savedEndSeconds =
    bookmark?.endTimeSeconds ?? (bookmark ? bookmark.startTimeSeconds + 30 : 0);
  const hasDirtyDraft = Boolean(
    bookmark &&
    (trimmedTitle !== bookmark.title.trim() ||
      note.trim() !== savedNote ||
      startSeconds !== bookmark.startTimeSeconds ||
      endSeconds !== savedEndSeconds),
  );
  const canSave = Boolean(
    bookmark && libraryItemId && trimmedTitle && hasDirtyDraft && !validationMessage && !isSaving,
  );
  const isThisClipPreview =
    Boolean(bookmarkId) &&
    previewBookmarkId === bookmarkId &&
    previewStatus !== "idle" &&
    previewStatus !== "error";
  const isPreviewing = isThisClipPreview && previewStatus !== "ended";
  const previewPositionSeconds = Math.max(
    startSeconds,
    Math.min(endSeconds, Math.round(previewPositionMs / 1000)),
  );
  const previewButtonLabel = isThisClipPreview
    ? previewStatus === "loading"
      ? "Loading..."
      : isPreviewing
        ? "Stop Preview"
        : "Preview Clip"
    : "Preview Clip";
  const handleDraftEditStart = useCallback(() => {
    if (!isPreviewing) return;
    void playerService.restoreListeningPositionAfterPreview();
  }, [isPreviewing]);

  const adjustStart = (delta: number) => {
    handleDraftEditStart();
    setStartSeconds((current) =>
      clampSeconds(
        current + delta,
        Math.max(trimWindowStartSeconds, endSeconds - MAX_CLIP_DURATION_SECONDS),
        endSeconds - MIN_CLIP_DURATION_SECONDS,
      ),
    );
  };

  const adjustEnd = (delta: number) => {
    handleDraftEditStart();
    setEndSeconds((current) => {
      const durationCap = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
      return clampSeconds(
        current + delta,
        startSeconds + MIN_CLIP_DURATION_SECONDS,
        Math.min(trimWindowEndSeconds, durationCap, startSeconds + MAX_CLIP_DURATION_SECONDS),
      );
    });
  };

  const handleTrimWindowDragStart = () => {
    trimWindowDragStartRef.current = {
      trimWindowStartSeconds,
      startSeconds,
      endSeconds,
    };
  };

  const handleTrimWindowChange = (
    nextWindowStartSeconds: number,
    gestureStartWindowSeconds: number,
  ) => {
    const maxWindowStartSeconds =
      durationSeconds > 0 ? Math.max(0, durationSeconds - trimWindowDurationSeconds) : 0;
    const clampedWindowStartSeconds = clampSeconds(nextWindowStartSeconds, 0, maxWindowStartSeconds);
    const dragStart = trimWindowDragStartRef.current;
    const deltaSeconds = clampedWindowStartSeconds - gestureStartWindowSeconds;
    if (deltaSeconds === 0) return;
    setTrimWindowStartSeconds(clampedWindowStartSeconds);
    setStartSeconds(dragStart.startSeconds + deltaSeconds);
    setEndSeconds(dragStart.endSeconds + deltaSeconds);
  };

  const handlePreview = async () => {
    if (!libraryItemId || validationMessage || !bookmark) return;
    try {
      if (isPreviewing) {
        await playerService.restoreListeningPositionAfterPreview();
        return;
      }
      await playerService.restoreListeningPositionAfterPreview();
      await playerService.playClipPreview({
        libraryItemId,
        bookmarkId: bookmark.id,
        startTimeSeconds: startSeconds,
        endTimeSeconds: endSeconds,
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
      time: startSeconds,
      title: trimmedTitle,
      createdAt: bookmark.createdAt,
    };

    setIsSaving(true);
    try {
      await addBookmark(libraryItemId, bookmarkPayload, {
        localBookmarkId: bookmark.id,
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: endSeconds,
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

  const renderStepButton = (label: "-5s" | "+5s", onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === "-5s" ? "Move 5 seconds backward" : "Move 5 seconds forward"}
      onPress={onPress}
      disabled={isSaving}
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
        opacity: isSaving ? 0.45 : pressed ? 0.78 : 1,
      })}
    >
      <Text selectable style={{ color: themeColors.text, fontSize: 13, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );

  const renderTimePanel = (
    label: string,
    valueSeconds: number,
    onDecrease: () => void,
    onIncrease: () => void,
  ) => (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        padding: 10,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          selectable
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ flex: 1, color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
        >
          {label}
        </Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {renderStepButton("-5s", onDecrease)}
          {renderStepButton("+5s", onIncrease)}
        </View>
      </View>
      <View
        style={{
          minHeight: 46,
          borderRadius: 12,
          borderCurve: "continuous",
          backgroundColor: themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 8,
        }}
      >
        <Text
          selectable
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            color: themeColors.text,
            fontSize: 18,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatSeconds(valueSeconds, "compact", true, true) ?? "00:00"}
        </Text>
      </View>
    </View>
  );

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

          <View style={{ gap: 8 }}>
            <ClipRangeScrubber
              startSeconds={startSeconds}
              endSeconds={endSeconds}
              trimWindowStartSeconds={trimWindowStartSeconds}
              trimWindowDurationSeconds={trimWindowDurationSeconds}
              disabled={isSaving}
              onChangeStart={setStartSeconds}
              onChangeEnd={setEndSeconds}
              onScrubbingChange={setIsScrubbing}
              onEditStart={handleDraftEditStart}
            />
            <ClipTrimWindowSlider
              trimWindowStartSeconds={trimWindowStartSeconds}
              trimWindowDurationSeconds={trimWindowDurationSeconds}
              bookDurationSeconds={durationSeconds}
              disabled={isSaving}
              onChangeTrimWindowStart={handleTrimWindowChange}
              onDragStart={handleTrimWindowDragStart}
              onScrubbingChange={setIsScrubbing}
              onEditStart={handleDraftEditStart}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {renderTimePanel(
                "Start Time",
                startSeconds,
                () => adjustStart(-STEP_SECONDS),
                () => adjustStart(STEP_SECONDS),
              )}
              {renderTimePanel(
                "End Time",
                endSeconds,
                () => adjustEnd(-STEP_SECONDS),
                () => adjustEnd(STEP_SECONDS),
              )}
            </View>
            {validationMessage ? (
              <Text selectable style={{ color: "#dc2626", fontSize: 12, textAlign: "center" }}>
                {validationMessage}
              </Text>
            ) : (
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
                Clip Duration: {formatSeconds(clipDurationSeconds, "compact", true, true)}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPreviewing ? "Stop clip preview" : "Preview clip"}
            onPress={() => {
              void handlePreview();
            }}
            disabled={Boolean(validationMessage)}
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
              opacity: validationMessage ? 0.5 : pressed ? 0.8 : 1,
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
