import { formatBookmarkDraftDuration } from "@/bookmarks/bookmark-draft";
import type { ClipSelectionRange } from "@/read-along/read-along-clip-selection";
import { Pressable, Text, View } from "react-native";

/**
 * The Clip Selection bar (ADR 0035).
 *
 * This bar *is* the selection mode — there is no toggle to find or forget, so
 * its presence has to carry that on its own. It states what is selected, offers
 * the only two exits, and takes the "Resume following" pill's slot, which the
 * reader suppresses while a selection is live (both floating there at once would
 * overlap).
 */

export type ReadAlongSelectionBarProps = {
  segmentCount: number;
  range: ClipSelectionRange | null;
  bottomOffset: number;
  themeColors: {
    accent: string;
    accentForeground: string;
    surface: string;
    border: string;
    text: string;
    textMuted: string;
  };
  onCancel: () => void;
  onSave: () => void;
};

export const ReadAlongSelectionBar = ({
  segmentCount,
  range,
  bottomOffset,
  themeColors,
  onCancel,
  onSave,
}: ReadAlongSelectionBarProps) => {
  const sentenceLabel = `${segmentCount} ${segmentCount === 1 ? "sentence" : "sentences"}`;
  const durationLabel = range ? formatBookmarkDraftDuration(range.durationSeconds) : null;
  // Both notices explain a range the reader can see is not the one they picked,
  // so they belong here rather than as a surprise in the Add Bookmark Sheet.
  const notice = range?.wasCappedAtMaximum
    ? "Trimmed to the maximum clip length"
    : range?.wasExtendedToMinimum
      ? "Extended to the minimum clip length"
      : null;

  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: bottomOffset,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        boxShadow: "0 10px 20px rgba(15, 23, 42, 0.22)",
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: themeColors.text }}>
          {durationLabel ? `${sentenceLabel} · ${durationLabel}` : sentenceLabel}
        </Text>
        <Text style={{ fontSize: 12, color: themeColors.textMuted, marginTop: 1 }}>
          {notice ?? "Tap to change the selection"}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel the selection"
        onPress={onCancel}
        style={({ pressed }) => ({
          borderRadius: 999,
          borderCurve: "continuous",
          paddingVertical: 8,
          paddingHorizontal: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: themeColors.textMuted }}>
          Cancel
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save the selection as a clip"
        disabled={!range}
        onPress={onSave}
        style={({ pressed }) => ({
          borderRadius: 999,
          borderCurve: "continuous",
          backgroundColor: themeColors.accent,
          paddingVertical: 8,
          paddingHorizontal: 16,
          opacity: !range ? 0.4 : pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontSize: 14, fontWeight: "700", color: themeColors.accentForeground }}>
          Save
        </Text>
      </Pressable>
    </View>
  );
};
