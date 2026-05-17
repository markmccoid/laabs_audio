import { usePlaybackStore } from "@/player";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";
import { MAX_CLIP_DURATION_SECONDS, MIN_CLIP_DURATION_SECONDS } from "./clip-timing";

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
  const [bookmarkTimeSeconds, setBookmarkTimeSeconds] = useState(() =>
    Math.max(0, Math.round(playbackPositionMs / 1000)),
  );
  const [clipEndTimeSeconds, setClipEndTimeSeconds] = useState(() =>
    Math.max(0, Math.round(playbackPositionMs / 1000) + DEFAULT_CLIP_DURATION_SECONDS),
  );
  const trimmedBookmarkName = bookmarkName.trim();
  const durationSeconds =
    itemDetails?.bookDuration ?? (playbackDurationMs > 0 ? Math.floor(playbackDurationMs / 1000) : 0);
  const isClip = bookmarkKind === "clip";
  const clipDurationSeconds = clipEndTimeSeconds - bookmarkTimeSeconds;
  const clipValidationMessage =
    isClip && clipDurationSeconds < MIN_CLIP_DURATION_SECONDS
      ? "Clip end must be after start."
      : isClip && clipDurationSeconds > MAX_CLIP_DURATION_SECONDS
        ? "Clip cannot be longer than 5 minutes."
        : isClip && durationSeconds > 0 && clipEndTimeSeconds > durationSeconds
          ? "Clip end cannot be past the end of the book."
          : null;

  const bookmarkTimeLabel = useMemo(
    () => formatSeconds(bookmarkTimeSeconds, "compact", true, true) ?? "00:00",
    [bookmarkTimeSeconds],
  );
  const clipEndTimeLabel = useMemo(
    () => formatSeconds(clipEndTimeSeconds, "compact", true, true) ?? "00:00",
    [clipEndTimeSeconds],
  );

  const adjustTime = (delta: number) => {
    setBookmarkTimeSeconds((current) => {
      const nextStart = Math.max(0, current + delta);
      if (isClip) {
        const durationCap = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
        if (clipEndTimeSeconds <= nextStart) {
          setClipEndTimeSeconds(
            Math.min(nextStart + DEFAULT_CLIP_DURATION_SECONDS, durationCap),
          );
        } else if (clipEndTimeSeconds - nextStart > MAX_CLIP_DURATION_SECONDS) {
          setClipEndTimeSeconds(Math.min(nextStart + MAX_CLIP_DURATION_SECONDS, durationCap));
        }
      }
      return nextStart;
    });
  };

  const adjustClipEndTime = (delta: number) => {
    setClipEndTimeSeconds((current) => {
      const durationCap = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
      return Math.max(
        bookmarkTimeSeconds + MIN_CLIP_DURATION_SECONDS,
        Math.min(current + delta, durationCap, bookmarkTimeSeconds + MAX_CLIP_DURATION_SECONDS),
      );
    });
  };

  const handleSave = async () => {
    if (!libraryItemId || isSaving) return;
    if (!trimmedBookmarkName) return;
    if (clipValidationMessage) return;
    const localNote = bookmarkNote.trim();

    const bookmarkPayload: Bookmark = {
      libraryItemId,
      time: bookmarkTimeSeconds,
      title: trimmedBookmarkName,
      createdAt: Date.now(),
      ...(localNote.length > 0 ? { notes: localNote } : {}),
    };

    setIsSaving(true);
    try {
      await addBookmark(libraryItemId, bookmarkPayload, {
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: isClip ? clipEndTimeSeconds : null,
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
    Boolean(libraryItemId) && Boolean(trimmedBookmarkName) && !clipValidationMessage && !isSaving;
  const timePanelBorderColor = themeColors.border;
  const timePanelFillColor = themeColors.bg;

  const renderStepButton = (label: "-5s" | "+5s", onPress: () => void, accessibilityLabel: string) => (
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

  return (
    <ScrollView
      style={{ flex: 1 }}
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
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}>
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
                if (kind === "clip" && clipEndTimeSeconds <= bookmarkTimeSeconds) {
                  setClipEndTimeSeconds(bookmarkTimeSeconds + DEFAULT_CLIP_DURATION_SECONDS);
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

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: isClip ? "row" : "column", gap: 8 }}>
          {renderTimePanel({
            label: isClip ? "Start Time" : "Position",
            value: bookmarkTimeLabel,
            onDecrease: () => adjustTime(-STEP_SECONDS),
            onIncrease: () => adjustTime(STEP_SECONDS),
          })}
          {isClip
            ? renderTimePanel({
                label: "End Time",
                value: clipEndTimeLabel,
                onDecrease: () => adjustClipEndTime(-STEP_SECONDS),
                onIncrease: () => adjustClipEndTime(STEP_SECONDS),
              })
            : null}
        </View>
        {isClip ? (
          clipValidationMessage ? (
            <Text selectable style={{ color: "#dc2626", fontSize: 12, textAlign: "center" }}>
              {clipValidationMessage}
            </Text>
          ) : (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, textAlign: "center" }}>
              Clip Duration: {formatSeconds(clipDurationSeconds, "compact", true, true)}
            </Text>
          )
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}>
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
  );
};
