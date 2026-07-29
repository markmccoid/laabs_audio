import type { BookmarkDraft } from "@/bookmarks/bookmark-contracts";
import {
  formatBookmarkDraftDuration,
  formatBookmarkDraftTime,
} from "@/bookmarks/bookmark-draft";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type BookmarkExportViewModel = {
  show: boolean;
  canExportAudio: boolean;
  canExportTranscript: boolean;
  isExportingAudio: boolean;
  isExportingTranscript: boolean;
  audioUnavailableReason?: string | null;
  transcriptUnavailableReason?: string | null;
};

export type BookmarkEditorModel = {
  mode: "add" | "detail";
  draft: BookmarkDraft;
  recordFound: boolean;
  isBusy: boolean;
  isSaving: boolean;
  canSave: boolean;
  targetAvailable: boolean;
  targetUnavailableMessage?: string;
  persistenceNotice?: string | null;
  export?: BookmarkExportViewModel;
};

export type BookmarkEditorActions = {
  onTitleChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onAdjustPosition: (deltaSeconds: number) => void;
  onOpenClipEditor: () => void;
  onRemoveClip: () => void;
  onSave: () => void;
  onCancel: () => void;
  onExportAudio?: () => void;
  onExportTranscript?: () => void;
};

const STEP_SECONDS = 5;

export const BookmarkEditorView = ({
  model,
  actions,
}: {
  model: BookmarkEditorModel;
  actions: BookmarkEditorActions;
}) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const isClip = model.draft.kind === "clip" && model.draft.endTimeSeconds !== null;
  const clipDurationSeconds = isClip
    ? Math.max(
        0,
        (model.draft.endTimeSeconds ?? model.draft.startTimeSeconds) -
          model.draft.startTimeSeconds,
      )
    : 0;
  const screenTitle =
    model.mode === "add"
      ? isClip
        ? "Create Clip"
        : "Add Bookmark"
      : isClip
        ? "Clip Bookmark"
        : "Bookmark Detail";
  const saveLabel =
    model.isSaving ? "Saving..." : model.mode === "add" && isClip ? "Save Clip" : "Save";
  const fieldBackgroundColor = model.mode === "detail" ? "#FFFFFF" : themeColors.surface;

  const renderStepButton = (label: "-5s" | "+5s", deltaSeconds: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Move position ${Math.abs(deltaSeconds)} seconds ${
        deltaSeconds < 0 ? "backward" : "forward"
      }`}
      onPress={() => actions.onAdjustPosition(deltaSeconds)}
      disabled={!model.targetAvailable || model.isBusy}
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
        opacity: !model.targetAvailable || model.isBusy ? 0.45 : pressed ? 0.78 : 1,
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

  const renderTitleField = () => (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}>
        Bookmark Title
      </Text>
      <TextInput
        value={model.draft.title}
        onChangeText={actions.onTitleChange}
        editable={!model.isBusy}
        placeholder="Enter a descriptive name"
        placeholderTextColor={themeColors.textMuted}
        cursorColor={themeColors.accent}
        selectionColor={themeColors.accent}
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
  );

  const renderNoteField = () => (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "600" }}>
        Local Note
      </Text>
      <TextInput
        value={model.draft.note}
        onChangeText={actions.onNoteChange}
        editable={!model.isBusy}
        placeholder="Add an optional note"
        placeholderTextColor={themeColors.textMuted}
        cursorColor={themeColors.accent}
        selectionColor={themeColors.accent}
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
  );

  const renderRange = () =>
    isClip ? (
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
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}>
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
              {formatBookmarkDraftTime(model.draft.startTimeSeconds)}
              {" -> "}
              {formatBookmarkDraftTime(
                model.draft.endTimeSeconds ?? model.draft.startTimeSeconds,
              )}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}>
              Duration
            </Text>
            <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "800" }}>
              {formatBookmarkDraftDuration(clipDurationSeconds)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit clip range"
            onPress={actions.onOpenClipEditor}
            disabled={model.isBusy}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 12,
              borderCurve: "continuous",
              backgroundColor: themeColors.accent,
              paddingVertical: 12,
              alignItems: "center",
              opacity: model.isBusy ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <Text selectable style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "800" }}>
              Edit Clip
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove clip"
            onPress={actions.onRemoveClip}
            disabled={model.isBusy}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: fieldBackgroundColor,
              paddingVertical: 12,
              alignItems: "center",
              opacity: model.isBusy ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "800" }}>
              Remove Clip
            </Text>
          </Pressable>
        </View>
      </View>
    ) : model.mode === "add" ? (
      <View
        style={{
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
            Position
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {renderStepButton("-5s", -STEP_SECONDS)}
            {renderStepButton("+5s", STEP_SECONDS)}
          </View>
        </View>
        <View
          style={{
            minHeight: 46,
            borderRadius: 12,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: fieldBackgroundColor,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 8,
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
            {formatBookmarkDraftTime(model.draft.startTimeSeconds)}
          </Text>
        </View>
      </View>
    ) : (
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
        <View style={{ gap: 4 }}>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}>
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
            {formatBookmarkDraftTime(model.draft.startTimeSeconds)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create clip"
          onPress={actions.onOpenClipEditor}
          disabled={model.isBusy}
          style={({ pressed }) => ({
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: themeColors.accent,
            paddingVertical: 12,
            alignItems: "center",
            opacity: model.isBusy ? 0.5 : pressed ? 0.82 : 1,
          })}
        >
          <Text selectable style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "800" }}>
            Create Clip
          </Text>
        </Pressable>
      </View>
    );

  const renderExportActions = () => {
    const exportModel = model.export;
    if (!exportModel?.show) return null;
    return (
      <View style={{ gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export audio clip"
          onPress={actions.onExportAudio}
          disabled={!exportModel.canExportAudio}
          style={({ pressed }) => ({
            borderRadius: 14,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: exportModel.canExportAudio ? themeColors.accent : themeColors.border,
            backgroundColor: exportModel.canExportAudio ? themeColors.accent : themeColors.surface,
            paddingHorizontal: 14,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: !exportModel.canExportAudio ? 0.55 : pressed ? 0.82 : 1,
          })}
        >
          <SymbolView
            name="square.and.arrow.up"
            tintColor={
              exportModel.canExportAudio ? themeColors.accentForeground : themeColors.textMuted
            }
            size={16}
          />
          <Text
            selectable
            style={{
              color:
                exportModel.canExportAudio ? themeColors.accentForeground : themeColors.textMuted,
              fontSize: 14,
              fontWeight: "700",
            }}
          >
            {exportModel.isExportingAudio ? "Exporting..." : "Export Audio Clip"}
          </Text>
        </Pressable>
        {exportModel.audioUnavailableReason ? (
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
            {exportModel.audioUnavailableReason}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export clip transcript"
          onPress={actions.onExportTranscript}
          disabled={!exportModel.canExportTranscript}
          style={({ pressed }) => ({
            borderRadius: 14,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: exportModel.canExportTranscript ? themeColors.accent : themeColors.border,
            backgroundColor: exportModel.canExportTranscript
              ? themeColors.accent
              : themeColors.surface,
            paddingHorizontal: 14,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: !exportModel.canExportTranscript ? 0.55 : pressed ? 0.82 : 1,
          })}
        >
          <SymbolView
            name="doc.text"
            tintColor={
              exportModel.canExportTranscript
                ? themeColors.accentForeground
                : themeColors.textMuted
            }
            size={16}
          />
          <Text
            selectable
            style={{
              color: exportModel.canExportTranscript
                ? themeColors.accentForeground
                : themeColors.textMuted,
              fontSize: 14,
              fontWeight: "700",
            }}
          >
            {exportModel.isExportingTranscript ? "Exporting..." : "Export Clip Transcript"}
          </Text>
        </Pressable>
        {exportModel.transcriptUnavailableReason ? (
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
            {exportModel.transcriptUnavailableReason}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      behavior="height"
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
            {screenTitle}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              model.mode === "detail" ? "Cancel bookmark detail" : "Cancel bookmark draft"
            }
            onPress={actions.onCancel}
            disabled={model.isBusy}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              alignItems: "center",
              justifyContent: "center",
              padding: 10,
              opacity: model.isBusy ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={model.mode === "detail" ? "Save bookmark edit" : "Save bookmark"}
            onPress={actions.onSave}
            disabled={!model.canSave}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.accent,
              backgroundColor: themeColors.accent,
              alignItems: "center",
              justifyContent: "center",
              padding: 10,
              opacity: !model.canSave ? 0.5 : pressed ? 0.82 : 1,
            })}
          >
            <Text
              selectable
              style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "700" }}
            >
              {saveLabel}
            </Text>
          </Pressable>
        </View>

        {model.persistenceNotice ? (
          <View
            style={{
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 12,
              paddingVertical: 10,
              gap: 2,
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 13, fontWeight: "700" }}>
              Saved on this device
            </Text>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {model.persistenceNotice}
            </Text>
          </View>
        ) : null}

        {model.mode === "detail" && !model.recordFound ? (
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
            {renderTitleField()}
            {renderRange()}
            {model.mode === "add" ? renderNoteField() : null}
            {model.mode === "add" && !isClip ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create clip"
                onPress={actions.onOpenClipEditor}
                disabled={!model.targetAvailable || model.isBusy || !model.draft.title.trim()}
                style={({ pressed }) => {
                  const enabled =
                    model.targetAvailable && !model.isBusy && Boolean(model.draft.title.trim());
                  return {
                    borderRadius: 14,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: enabled ? themeColors.accent : themeColors.border,
                    backgroundColor: enabled ? themeColors.accent : themeColors.surface,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: !enabled ? 0.5 : pressed ? 0.82 : 1,
                  };
                }}
              >
                <SymbolView
                  name="waveform"
                  tintColor={
                    model.targetAvailable && model.draft.title.trim()
                      ? themeColors.accentForeground
                      : themeColors.textMuted
                  }
                  size={18}
                />
                <Text
                  selectable
                  style={{
                    color:
                      model.targetAvailable && model.draft.title.trim()
                        ? themeColors.accentForeground
                        : themeColors.textMuted,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                >
                  Create Clip
                </Text>
              </Pressable>
            ) : null}
            {model.mode === "detail" ? renderExportActions() : null}
            {model.mode === "detail" ? renderNoteField() : null}
          </>
        )}

        {model.mode === "add" && !model.targetAvailable ? (
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
              {model.targetUnavailableMessage ??
                "No active media is loaded. Start playback, then reopen this sheet."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
