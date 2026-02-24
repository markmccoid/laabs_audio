import { usePlaybackStore } from "@/player";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "react-native-sonner";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const STEP_SECONDS = 5;

export const BookAddBookmarkSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { addBookmark } = useDeviceBooksActions();
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);

  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam) ?? playbackLibraryItemId ?? undefined;

  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [bookmarkTimeSeconds, setBookmarkTimeSeconds] = useState(() =>
    Math.max(0, Math.round(playbackPositionMs / 1000)),
  );
  const trimmedBookmarkName = bookmarkName.trim();

  const bookmarkTimeLabel = useMemo(
    () => formatSeconds(bookmarkTimeSeconds, "compact", true, true) ?? "00:00",
    [bookmarkTimeSeconds],
  );

  const adjustTime = (delta: number) => {
    setBookmarkTimeSeconds((current) => Math.max(0, current + delta));
  };

  const handleSave = async () => {
    if (!libraryItemId || isSaving) return;
    if (!trimmedBookmarkName) return;
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
      });
      toast.success("Bookmark added");
      router.back();
    } catch (error) {
      console.warn("[BookAddBookmarkSheet] Failed to add bookmark", error);
      toast.error("Unable to add bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = Boolean(libraryItemId) && Boolean(trimmedBookmarkName) && !isSaving;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
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
          <Text selectable style={{ color: themeColors.text, fontSize: 20, fontWeight: "700" }}>
            Add Bookmark
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
            <Text selectable style={{ color: "#ffffff", fontSize: 14, fontWeight: "700" }}>
              {isSaving ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          Position is captured when this sheet opens. Adjust in 5 second steps if needed.
        </Text>
      </View>

      <View
        style={{
          borderRadius: 16,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          padding: 12,
          gap: 10,
        }}
      >
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}>
          Position
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move bookmark 5 seconds backward"
            onPress={() => adjustTime(-STEP_SECONDS)}
            disabled={!libraryItemId || isSaving}
            style={({ pressed }) => ({
              width: 46,
              height: 46,
              borderRadius: 23,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              alignItems: "center",
              justifyContent: "center",
              opacity: !libraryItemId || isSaving ? 0.45 : pressed ? 0.82 : 1,
            })}
          >
            <SymbolView name="gobackward.5" size={20} tintColor={themeColors.text} />
          </Pressable>

          <View
            style={{
              flex: 1,
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              paddingVertical: 11,
              alignItems: "center",
              justifyContent: "center",
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
              {bookmarkTimeLabel}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move bookmark 5 seconds forward"
            onPress={() => adjustTime(STEP_SECONDS)}
            disabled={!libraryItemId || isSaving}
            style={({ pressed }) => ({
              width: 46,
              height: 46,
              borderRadius: 23,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              alignItems: "center",
              justifyContent: "center",
              opacity: !libraryItemId || isSaving ? 0.45 : pressed ? 0.82 : 1,
            })}
          >
            <SymbolView name="goforward.5" size={20} tintColor={themeColors.text} />
          </Pressable>
        </View>
      </View>

      <View
        style={{
          borderRadius: 16,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          padding: 12,
          gap: 12,
        }}
      >
        <View style={{ gap: 6 }}>
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}
          >
            Bookmark Name
          </Text>
          <TextInput
            value={bookmarkName}
            onChangeText={setBookmarkName}
            editable={!isSaving}
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
