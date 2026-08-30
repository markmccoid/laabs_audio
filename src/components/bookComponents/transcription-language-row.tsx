import { useThemeColors } from "@/theme/use-app-theme";
import {
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  describeTranscriptionLocale,
} from "@/transcription/transcription-planning";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * The language control shared by the Book Transcript start sheet and the
 * download sheet's "also transcribe" checkbox (plan Phase 4 items 2 and 3).
 *
 * English is silent: the caller only sets `needsConfirmation` when the book's
 * metadata says the book is non-English, which highlights the row so the user
 * confirms it. The picker expands inline — both callers are themselves form
 * sheets, and stacking another sheet on top of a form sheet is not a pattern
 * this app uses.
 */

type Props = {
  localeIdentifier: string;
  onChange: (localeIdentifier: string) => void;
  /** Highlight the row: metadata says this book is not in English. */
  needsConfirmation?: boolean;
  /** `row` = full-width labelled row (start sheet); `inline` = compact pill. */
  variant?: "row" | "inline";
  disabled?: boolean;
};

export const TranscriptionLanguageRow = ({
  localeIdentifier,
  onChange,
  needsConfirmation = false,
  variant = "row",
  disabled = false,
}: Props) => {
  const themeColors = useThemeColors();
  const [isExpanded, setIsExpanded] = useState(false);
  const label = describeTranscriptionLocale(localeIdentifier);
  const highlightColor = needsConfirmation ? themeColors.absGold : themeColors.border;

  const optionList = isExpanded ? (
    <View
      style={{
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.bg,
        overflow: "hidden",
      }}
    >
      {TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => {
        const isSelected =
          option.localeIdentifier.toLowerCase() === localeIdentifier.toLowerCase();
        return (
          <Pressable
            key={option.localeIdentifier}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              onChange(option.localeIdentifier);
              setIsExpanded(false);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: pressed ? themeColors.border : "transparent",
            })}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: isSelected ? "700" : "500",
                color: themeColors.text,
              }}
            >
              {option.label}
            </Text>
            {isSelected ? (
              <SymbolView name="checkmark" size={14} tintColor={themeColors.accent} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  ) : null;

  if (variant === "inline") {
    return (
      <View style={{ gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Transcription language: ${label}`}
          disabled={disabled}
          onPress={() => setIsExpanded((current) => !current)}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: highlightColor,
            backgroundColor: themeColors.bg,
            paddingHorizontal: 10,
            paddingVertical: 5,
            opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: themeColors.text }}>{label}</Text>
          <SymbolView name="chevron.up.chevron.down" size={10} tintColor={themeColors.textMuted} />
        </Pressable>
        {optionList}
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Transcription language: ${label}`}
        disabled={disabled}
        onPress={() => setIsExpanded((current) => !current)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: 12,
          borderCurve: "continuous",
          borderWidth: needsConfirmation ? 2 : 1,
          borderColor: highlightColor,
          backgroundColor: themeColors.bg,
          paddingHorizontal: 12,
          paddingVertical: 10,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        })}
      >
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: themeColors.textMuted }}>
            Language
          </Text>
          <Text style={{ fontSize: 15, fontWeight: "700", color: themeColors.text }}>{label}</Text>
        </View>
        <SymbolView name="chevron.up.chevron.down" size={13} tintColor={themeColors.textMuted} />
      </Pressable>
      {needsConfirmation ? (
        <Text style={{ fontSize: 12, color: themeColors.textMuted }}>
          This book&apos;s metadata is not English — confirm the language before starting.
        </Text>
      ) : null}
      {optionList}
    </View>
  );
};

export default TranscriptionLanguageRow;
