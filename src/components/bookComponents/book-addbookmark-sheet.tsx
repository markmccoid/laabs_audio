import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService, useClipPreviewStore, usePlaybackStore } from "@/player";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ClipRangeEditor } from "./clip-range-editor";
import { useClipRangeDraft } from "./use-clip-range-draft";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const STEP_SECONDS = 5;
const DEFAULT_CLIP_DURATION_SECONDS = 30;

export const BookAddBookmarkSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { addBookmark } = useDeviceBooksActions();
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);

  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam) ?? playbackLibraryItemId ?? undefined;
  const { data: itemDetails } = useGetItemDetails(libraryItemId);

  const [bookmarkKind, setBookmarkKind] = useState<"point" | "clip">("point");
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const hasActivatedClipRef = useRef(false);
  const [bookmarkTimeSeconds, setBookmarkTimeSeconds] = useState(() =>
    Math.max(0, Math.round(playbackPositionMs / 1000)),
  );
  const trimmedBookmarkName = bookmarkName.trim();
  const durationSeconds =
    itemDetails?.bookDuration ??
    (playbackDurationMs > 0 ? Math.floor(playbackDurationMs / 1000) : 0);
  const isClip = bookmarkKind === "clip";
  const draftPreviewId = libraryItemId ? `draft:add-clip:${libraryItemId}` : null;
  const previewStatus = useClipPreviewStore((state) => state.status);
  const previewBookmarkId = useClipPreviewStore((state) => state.bookmarkId);
  const previewPositionMs = useClipPreviewStore((state) => state.positionMs);
  const isThisDraftPreview =
    Boolean(draftPreviewId) &&
    previewBookmarkId === draftPreviewId &&
    previewStatus !== "idle" &&
    previewStatus !== "error";
  const isPreviewing = isThisDraftPreview && previewStatus !== "ended";
  const handleDraftEditStart = useCallback(() => {
    if (!isPreviewing) return;
    void playerService.restoreListeningPositionAfterPreview();
  }, [isPreviewing]);
  const clipDraft = useClipRangeDraft({
    initialStartSeconds: Math.max(0, Math.round(playbackPositionMs / 1000)),
    initialEndSeconds: Math.max(
      0,
      Math.round(playbackPositionMs / 1000) + DEFAULT_CLIP_DURATION_SECONDS,
    ),
    bookDurationSeconds: durationSeconds,
    onEditStart: handleDraftEditStart,
  });
  const previewPositionSeconds = Math.max(
    clipDraft.startSeconds,
    Math.min(clipDraft.endSeconds, Math.round(previewPositionMs / 1000)),
  );
  const previewButtonLabel = isThisDraftPreview
    ? previewStatus === "loading"
      ? "Loading..."
      : isPreviewing
        ? "Stop Preview"
        : "Preview Clip"
    : "Preview Clip";

  const bookmarkTimeLabel = useMemo(
    () => formatSeconds(bookmarkTimeSeconds, "compact", true, true) ?? "00:00",
    [bookmarkTimeSeconds],
  );

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  const adjustTime = (delta: number) => {
    setBookmarkTimeSeconds((current) => Math.max(0, current + delta));
  };

  const handleSave = async () => {
    if (!libraryItemId || isSaving) return;
    if (!trimmedBookmarkName) return;
    if (isClip && clipDraft.validationMessage) return;
    const localNote = bookmarkNote.trim();

    const bookmarkPayload: Bookmark = {
      libraryItemId,
      time: isClip ? clipDraft.startSeconds : bookmarkTimeSeconds,
      title: trimmedBookmarkName,
      createdAt: Date.now(),
      ...(localNote.length > 0 ? { notes: localNote } : {}),
    };

    setIsSaving(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      await addBookmark(libraryItemId, bookmarkPayload, {
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: isClip ? clipDraft.endSeconds : null,
      });
      Keyboard.dismiss();
      toast.success("Bookmark added");
      router.back();
    } catch (error) {
      console.warn("[BookAddBookmarkSheet] Failed to add bookmark", error);
      toast.error("Unable to add bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const canSave =
    Boolean(libraryItemId) &&
    Boolean(trimmedBookmarkName) &&
    !(isClip && clipDraft.validationMessage) &&
    !isSaving;
  const canPreviewClip = Boolean(
    isClip &&
    libraryItemId &&
    draftPreviewId &&
    trimmedBookmarkName &&
    !clipDraft.validationMessage &&
    !isSaving,
  );
  const timePanelBorderColor = themeColors.border;
  const timePanelFillColor = themeColors.bg;

  const renderStepButton = (
    label: "-5s" | "+5s",
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={!libraryItemId || isSaving}
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
        opacity: !libraryItemId || isSaving ? 0.45 : pressed ? 0.78 : 1,
      })}
    >
      <Text selectable style={{ color: themeColors.text, fontSize: 13, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );

  const renderTimePanel = ({
    label,
    value,
    onDecrease,
    onIncrease,
  }: {
    label: string;
    value: string;
    onDecrease: () => void;
    onIncrease: () => void;
  }) => (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: timePanelBorderColor,
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
          {renderStepButton("-5s", onDecrease, `Move ${label.toLowerCase()} 5 seconds backward`)}
          {renderStepButton("+5s", onIncrease, `Move ${label.toLowerCase()} 5 seconds forward`)}
        </View>
      </View>
      <View
        style={{
          minHeight: 46,
          borderRadius: 12,
          borderCurve: "continuous",
          backgroundColor: timePanelFillColor,
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
          {value}
        </Text>
      </View>
    </View>
  );

  const handlePreview = async () => {
    if (!libraryItemId || !draftPreviewId || !canPreviewClip) return;
    try {
      if (isPreviewing) {
        await playerService.restoreListeningPositionAfterPreview();
        return;
      }
      await playerService.restoreListeningPositionAfterPreview();
      await playerService.playClipPreview({
        libraryItemId,
        bookmarkId: draftPreviewId,
        startTimeSeconds: clipDraft.startSeconds,
        endTimeSeconds: clipDraft.endSeconds,
      });
    } catch (error) {
      console.warn("[BookAddBookmarkSheet] Failed to preview clip", error);
      toast.error("Unable to preview clip");
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      behavior={Platform.OS === "ios" ? "height" : "height"}
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
        <Stack.Screen options={{ title: "Add Bookmark" }} />

        <View style={{ gap: 4 }}>
          <View className="flex-row justify-between items-center">
            <Text
              selectable
              style={{
                flex: 1,
                paddingRight: 14,
                color: themeColors.text,
                fontSize: 20,
                lineHeight: 26,
                fontWeight: "700",
              }}
            >
              Add Bookmark/Clip
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save bookmark"
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
        </View>

        <View style={{ gap: 6 }}>
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
          >
            Bookmark Title
          </Text>
          <TextInput
            value={bookmarkName}
            onChangeText={setBookmarkName}
            editable={!isSaving}
            placeholder="Enter a descriptive name"
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

        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["point", "clip"] as const).map((kind) => {
            const selected = bookmarkKind === kind;
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityLabel={kind === "point" ? "Save as bookmark" : "Save as clip"}
                onPress={() => {
                  setBookmarkKind(kind);
                  if (kind === "clip" && !hasActivatedClipRef.current) {
                    hasActivatedClipRef.current = true;
                    clipDraft.resetDraft(
                      bookmarkTimeSeconds,
                      bookmarkTimeSeconds + DEFAULT_CLIP_DURATION_SECONDS,
                    );
                  }
                }}
                disabled={isSaving}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: selected ? themeColors.accent : themeColors.border,
                  backgroundColor: selected ? themeColors.accent : themeColors.surface,
                  paddingVertical: 10,
                  alignItems: "center",
                  opacity: pressed || isSaving ? 0.8 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: selected ? themeColors.accentForeground : themeColors.text,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  {kind === "point" ? "Bookmark" : "Clip"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isClip ? (
          <>
            <ClipRangeEditor
              draft={clipDraft}
              bookDurationSeconds={durationSeconds}
              disabled={isSaving}
              onScrubbingChange={setIsScrubbing}
            />
            {trimmedBookmarkName ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isPreviewing ? "Stop clip preview" : "Preview clip"}
                  onPress={() => {
                    void handlePreview();
                  }}
                  disabled={!canPreviewClip}
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
                    opacity: !canPreviewClip ? 0.5 : pressed ? 0.8 : 1,
                  })}
                >
                  <SymbolView
                    name={isPreviewing ? "pause.fill" : "play.fill"}
                    tintColor={themeColors.accent}
                    size={16}
                  />
                  <Text
                    selectable
                    style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}
                  >
                    {previewButtonLabel}
                  </Text>
                </Pressable>

                {isThisDraftPreview ? (
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
              </>
            ) : null}
          </>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "column", gap: 8 }}>
              {renderTimePanel({
                label: "Position",
                value: bookmarkTimeLabel,
                onDecrease: () => adjustTime(-STEP_SECONDS),
                onIncrease: () => adjustTime(STEP_SECONDS),
              })}
            </View>
          </View>
        )}

        <View style={{ gap: 6 }}>
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
          >
            Local Note
          </Text>
          <TextInput
            value={bookmarkNote}
            onChangeText={setBookmarkNote}
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

        {!libraryItemId ? (
          <View
            style={{
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              No active book is loaded. Start playback, then reopen this sheet.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
