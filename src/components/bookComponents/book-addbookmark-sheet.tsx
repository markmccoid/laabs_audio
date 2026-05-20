import { playerService } from "@/player";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
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

const STEP_SECONDS = 5;
export const BookAddBookmarkSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { addBookmark } = useDeviceBooksActions();
  const draft = useBookAddBookmarkDraft();
  const [isSaving, setIsSaving] = useState(false);
  const trimmedBookmarkName = draft.title.trim();
  const isClipDraft = draft.kind === "clip" && draft.clipEndSeconds !== null;
  const clipDurationSeconds = isClipDraft
    ? Math.max(0, (draft.clipEndSeconds ?? draft.positionSeconds) - draft.positionSeconds)
    : 0;
  const screenTitle = isClipDraft ? "Create Clip" : "Add Bookmark";
  const saveLabel = isClipDraft ? "Save Clip" : "Save";

  useEffect(() => {
    return () => {
      void playerService.restoreListeningPositionAfterPreview();
    };
  }, []);

  const adjustTime = (delta: number) => {
    draft.setPointPosition(draft.positionSeconds + delta);
  };

  const handleSave = async () => {
    if (!draft.libraryItemId || isSaving) return;
    if (!trimmedBookmarkName) return;
    const localNote = draft.localNote.trim();

    const bookmarkPayload: Bookmark = {
      libraryItemId: draft.libraryItemId,
      time: draft.positionSeconds,
      title: trimmedBookmarkName,
      createdAt: Date.now(),
      ...(localNote.length > 0 ? { notes: localNote } : {}),
    };

    setIsSaving(true);
    try {
      await playerService.restoreListeningPositionAfterPreview();
      await addBookmark(draft.libraryItemId, bookmarkPayload, {
        localNote: localNote.length > 0 ? localNote : null,
        endTimeSeconds: isClipDraft ? draft.clipEndSeconds : null,
      });
      Keyboard.dismiss();
      toast.success(isClipDraft ? "Clip saved" : "Bookmark added");
      router.back();
    } catch (error) {
      console.warn("[BookAddBookmarkSheet] Failed to add bookmark", error);
      toast.error("Unable to add bookmark");
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = Boolean(draft.libraryItemId) && Boolean(trimmedBookmarkName) && !isSaving;
  const canAddClip = Boolean(draft.libraryItemId) && Boolean(trimmedBookmarkName) && !isSaving;
  const timePanelBorderColor = themeColors.border;
  const fieldBackgroundColor = "#FFFFFF";
  const timePanelFillColor = fieldBackgroundColor;

  const renderStepButton = (
    label: "-5s" | "+5s",
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={!draft.libraryItemId || isSaving}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        borderCurve: "continuous",
        borderWidth: 1.5,
        borderColor: themeColors.accent,
        backgroundColor: themeColors.accent,
        alignItems: "center",
        justifyContent: "center",
        opacity: !draft.libraryItemId || isSaving ? 0.45 : pressed ? 0.78 : 1,
      })}
    >
      <Text
        selectable
        style={{ color: themeColors.accentForeground, fontSize: 13, fontWeight: "800" }}
      >
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
        borderWidth: 1.5,
        borderColor: themeColors.accent,
        backgroundColor: themeColors.surface,
        padding: 12,
        gap: 10,
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
          borderWidth: 1,
          borderColor: timePanelBorderColor,
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

  const openClipEditor = () => {
    if (!canAddClip) return;
    draft.convertToClipDraft();
    router.push("/book-addbookmark/clip-editor");
  };

  const closeDraft = async () => {
    await playerService.restoreListeningPositionAfterPreview();
    Keyboard.dismiss();
    router.back();
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
          // paddingTop: Math.max(30, insets.top + 16),
          paddingTop: 15,
          paddingBottom: Math.max(24, insets.bottom + 12),
          backgroundColor: themeColors.bg,
        }}
      >
        <Stack.Screen options={{ title: screenTitle }} />

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
              {screenTitle}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel bookmark draft"
              onPress={() => {
                void closeDraft();
              }}
              disabled={isSaving}
              style={({ pressed }) => ({
                borderRadius: 12,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                alignItems: "center",
                justifyContent: "center",
                padding: 10,
                marginHorizontal: 10,
                opacity: isSaving ? 0.5 : pressed ? 0.82 : 1,
              })}
            >
              <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
                Cancel
              </Text>
            </Pressable>
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
                {isSaving ? "Saving..." : saveLabel}
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
            value={draft.title}
            onChangeText={draft.setTitle}
            editable={!isSaving}
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

        {isClipDraft ? (
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
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit clip range"
                onPress={openClipEditor}
                disabled={isSaving}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  backgroundColor: themeColors.accent,
                  paddingVertical: 12,
                  alignItems: "center",
                  opacity: isSaving ? 0.5 : pressed ? 0.82 : 1,
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
                  Edit Clip
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove clip"
                onPress={draft.removeClip}
                disabled={isSaving}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: fieldBackgroundColor,
                  paddingVertical: 12,
                  alignItems: "center",
                  opacity: isSaving ? 0.5 : pressed ? 0.82 : 1,
                })}
              >
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 14, fontWeight: "800" }}
                >
                  Remove Clip
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "column", gap: 8 }}>
              {renderTimePanel({
                label: "Position",
                value: formatBookmarkDraftTime(draft.positionSeconds),
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
            value={draft.localNote}
            onChangeText={draft.setLocalNote}
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
              backgroundColor: fieldBackgroundColor,
              color: themeColors.text,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 14,
            }}
          />
        </View>

        {!isClipDraft ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create clip"
            onPress={openClipEditor}
            disabled={!canAddClip}
            style={({ pressed }) => ({
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: canAddClip ? themeColors.accent : themeColors.border,
              backgroundColor: canAddClip ? themeColors.accent : themeColors.surface,
              paddingHorizontal: 14,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: !canAddClip ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <SymbolView
              name="waveform"
              tintColor={canAddClip ? themeColors.accentForeground : themeColors.textMuted}
              size={18}
            />
            <Text
              selectable
              style={{
                color: canAddClip ? themeColors.accentForeground : themeColors.textMuted,
                fontSize: 14,
                fontWeight: "700",
              }}
            >
              Create Clip
            </Text>
          </Pressable>
        ) : null}

        {!draft.libraryItemId ? (
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
