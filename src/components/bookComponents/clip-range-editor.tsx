import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ClipRangeScrubber } from "./clip-range-scrubber";
import { ClipTrimWindowSlider } from "./clip-trim-window-slider";
import type { ClipRangeDraft } from "./use-clip-range-draft";

const STEP_SECONDS = 5;

type Props = {
  draft: ClipRangeDraft;
  bookDurationSeconds: number;
  disabled?: boolean;
  rangeAccessory?: ReactNode;
  onScrubbingChange?: (isScrubbing: boolean) => void;
};

export const ClipRangeEditor = ({
  draft,
  bookDurationSeconds,
  disabled = false,
  rangeAccessory,
  onScrubbingChange,
}: Props) => {
  const themeColors = useThemeColors();

  const renderStepButton = (label: "-5s" | "+5s", onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === "-5s" ? "Move 5 seconds backward" : "Move 5 seconds forward"}
      onPress={onPress}
      disabled={disabled}
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
        opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
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
    <View style={{ gap: 8 }}>
      <ClipRangeScrubber
        startSeconds={draft.startSeconds}
        endSeconds={draft.endSeconds}
        trimWindowStartSeconds={draft.trimWindowStartSeconds}
        trimWindowDurationSeconds={draft.trimWindowDurationSeconds}
        disabled={disabled}
        onChangeStart={draft.setStartSeconds}
        onChangeEnd={draft.setEndSeconds}
        onScrubbingChange={onScrubbingChange}
        onEditStart={draft.handleEditStart}
      />
      {rangeAccessory}
      <ClipTrimWindowSlider
        trimWindowStartSeconds={draft.trimWindowStartSeconds}
        trimWindowDurationSeconds={draft.trimWindowDurationSeconds}
        bookDurationSeconds={bookDurationSeconds}
        disabled={disabled}
        onChangeTrimWindowStart={draft.handleTrimWindowChange}
        onDragStart={draft.handleTrimWindowDragStart}
        onScrubbingChange={onScrubbingChange}
        onEditStart={draft.handleEditStart}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {renderTimePanel(
          "Start Time",
          draft.startSeconds,
          () => draft.adjustStart(-STEP_SECONDS),
          () => draft.adjustStart(STEP_SECONDS),
        )}
        {renderTimePanel(
          "End Time",
          draft.endSeconds,
          () => draft.adjustEnd(-STEP_SECONDS),
          () => draft.adjustEnd(STEP_SECONDS),
        )}
      </View>
      {draft.validationMessage ? (
        <Text selectable style={{ color: "#dc2626", fontSize: 12, textAlign: "center" }}>
          {draft.validationMessage}
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
          Clip Duration: {formatSeconds(draft.clipDurationSeconds, "compact", true, true)}
        </Text>
      )}
    </View>
  );
};
