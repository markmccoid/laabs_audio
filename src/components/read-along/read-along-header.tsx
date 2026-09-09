import {
  READ_ALONG_WORD_HIGHLIGHT_COUNTS,
  READ_ALONG_WORD_HIGHLIGHT_STYLES,
  resolveWordHighlightStyle,
  type ReadAlongWordHighlightCount,
  type ReadAlongWordHighlightStyle,
} from "@/read-along/read-along-rendering";
import {
  READ_ALONG_FOLLOW_ALIGNMENTS,
  type ReadAlongFollowAlignment,
} from "@/read-along/read-along-follow-alignment";
import {
  MAX_READ_ALONG_FONT_SIZE,
  MIN_READ_ALONG_FONT_SIZE,
  useSettingsActions,
} from "@/store/settings-store";
import type { ThemeColors } from "@/theme/use-app-theme";
import { ReadAlongBookAppearance } from "./read-along-appearance-book";
import { ReadAlongPopoverBackdrop } from "./read-along-popover-backdrop";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Read-Along chrome: close, book title, chapters, and the `Aa` appearance
 * popover (`docs/read-along-implementation-plan.md` Phase 3.3, extended by
 * "v1.1 — Highlight styles").
 *
 * The popover is a plain absolutely-positioned card rather than a Modal — the
 * reader is already a full-screen card route, and a Modal over it fights the
 * route's vertical dismiss gesture. It also means the reader stays visible
 * behind the card, so both preferences preview live on the real text.
 */

const WORD_HIGHLIGHT_LABELS: Record<ReadAlongWordHighlightStyle, string> = {
  highlight: "Highlight",
  color: "Color",
  bold: "Bold",
  none: "None",
};

const FOLLOW_ALIGNMENT_LABELS: Record<ReadAlongFollowAlignment, string> = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};

/** The word the style rows render in their own style, so the labels aren't guesses. */
const WORD_HIGHLIGHT_SAMPLE = "word";

type ReadAlongHeaderProps = {
  title: string;
  fontSize: number;
  followAlignment: ReadAlongFollowAlignment;
  wordHighlightCount: ReadAlongWordHighlightCount;
  wordHighlightStyle: ReadAlongWordHighlightStyle;
  /**
   * Which surface the popover is configuring. The two share nothing but the
   * button: on the Book surface the app draws none of the text, so the
   * transcript's rows have nothing to act on (see `ReadAlongBookAppearance`).
   */
  isBookSurface: boolean;
  themeColors: ThemeColors;
  topInset: number;
  onClose: () => void;
  onOpenChapters: () => void;
};

const FollowAlignmentOption = ({
  alignment,
  isSelected,
  onSelect,
  themeColors,
}: {
  alignment: ReadAlongFollowAlignment;
  isSelected: boolean;
  onSelect: (alignment: ReadAlongFollowAlignment) => void;
  themeColors: ThemeColors;
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityLabel={`${FOLLOW_ALIGNMENT_LABELS[alignment]} follow position`}
    accessibilityState={{ selected: isSelected, checked: isSelected }}
    onPress={() => onSelect(alignment)}
    style={({ pressed }) => ({
      flex: 1,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      borderCurve: "continuous",
      backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
      opacity: pressed ? 0.7 : 1,
    })}
  >
    <Text
      style={{
        fontSize: 13,
        fontWeight: "700",
        color: isSelected ? themeColors.accentForeground : themeColors.text,
      }}
    >
      {FOLLOW_ALIGNMENT_LABELS[alignment]}
    </Text>
  </Pressable>
);

const HeaderButton = ({
  icon,
  label,
  onPress,
  tintColor,
  backgroundColor,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  tintColor: string;
  backgroundColor: string;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    hitSlop={8}
    style={({ pressed }) => ({
      width: 36,
      height: 36,
      borderRadius: 18,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor,
      opacity: pressed ? 0.7 : 1,
    })}
  >
    <SymbolView name={icon} size={18} tintColor={tintColor} />
  </Pressable>
);

const StepperButton = ({
  label,
  symbol,
  disabled,
  onPress,
  themeColors,
}: {
  label: string;
  symbol: string;
  disabled: boolean;
  onPress: () => void;
  themeColors: ThemeColors;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => ({
      width: 40,
      height: 36,
      borderRadius: 10,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: themeColors.bg,
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    })}
  >
    <Text style={{ fontSize: 18, fontWeight: "700", color: themeColors.text }}>{symbol}</Text>
  </Pressable>
);

const SectionLabel = ({ text, color }: { text: string; color: string }) => (
  <Text
    style={{
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color,
    }}
  >
    {text}
  </Text>
);

const WordCountOption = ({
  count,
  isSelected,
  onSelect,
  themeColors,
}: {
  count: ReadAlongWordHighlightCount;
  isSelected: boolean;
  onSelect: (count: ReadAlongWordHighlightCount) => void;
  themeColors: ThemeColors;
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityLabel={`${count} ${count === 1 ? "word" : "words"}`}
    accessibilityState={{ selected: isSelected, checked: isSelected }}
    onPress={() => onSelect(count)}
    style={({ pressed }) => ({
      flex: 1,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      borderCurve: "continuous",
      backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
      opacity: pressed ? 0.7 : 1,
    })}
  >
    <Text
      style={{
        fontSize: 14,
        fontWeight: "700",
        color: isSelected ? themeColors.accentForeground : themeColors.text,
        fontVariant: ["tabular-nums"],
      }}
    >
      {count}
    </Text>
  </Pressable>
);

const WordHighlightRow = ({
  style,
  isSelected,
  onSelect,
  themeColors,
}: {
  style: ReadAlongWordHighlightStyle;
  isSelected: boolean;
  onSelect: (style: ReadAlongWordHighlightStyle) => void;
  themeColors: ThemeColors;
}) => {
  const appearance = resolveWordHighlightStyle(style, { accent: themeColors.accent });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={WORD_HIGHLIGHT_LABELS[style]}
      accessibilityState={{ selected: isSelected, checked: isSelected }}
      onPress={() => onSelect(style)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 10,
        borderCurve: "continuous",
        paddingVertical: 7,
        paddingHorizontal: 8,
        backgroundColor: isSelected ? themeColors.bg : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ flex: 1, fontSize: 14, color: themeColors.text }}>
        {WORD_HIGHLIGHT_LABELS[style]}
      </Text>
      {/* The sample is rendered in the style it names, so the label never has
          to describe what the treatment looks like. */}
      <Text style={[{ fontSize: 14, color: themeColors.text }, appearance]}>
        {WORD_HIGHLIGHT_SAMPLE}
      </Text>
      <View style={{ width: 16, alignItems: "center" }}>
        {isSelected ? (
          <SymbolView name="checkmark" size={13} tintColor={themeColors.accent} />
        ) : null}
      </View>
    </Pressable>
  );
};

export const ReadAlongHeader = ({
  title,
  fontSize,
  followAlignment,
  wordHighlightCount,
  wordHighlightStyle,
  isBookSurface,
  themeColors,
  topInset,
  onClose,
  onOpenChapters,
}: ReadAlongHeaderProps) => {
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const {
    setReadAlongFontSize,
    setReadAlongFollowAlignment,
    setReadAlongWordHighlightCount,
    setReadAlongWordHighlightStyle,
  } = useSettingsActions();

  return (
    <View
      style={{
        paddingTop: topInset + 8,
        paddingBottom: 10,
        paddingHorizontal: 12,
        backgroundColor: themeColors.bg,
        borderBottomWidth: 1,
        borderBottomColor: themeColors.border,
        zIndex: 2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <HeaderButton
          icon="chevron.down"
          label="Close Read-Along"
          onPress={onClose}
          tintColor={themeColors.text}
          backgroundColor={themeColors.surface}
        />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 14,
            fontWeight: "600",
            color: themeColors.text,
          }}
        >
          {title}
        </Text>
        <HeaderButton
          icon="list.bullet"
          label="Chapters"
          onPress={onOpenChapters}
          tintColor={themeColors.text}
          backgroundColor={themeColors.surface}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reading appearance"
          accessibilityState={{ expanded: isAppearanceOpen }}
          onPress={() => setIsAppearanceOpen((open) => !open)}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isAppearanceOpen ? themeColors.accent : themeColors.surface,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              fontSize: 15,
              fontWeight: "700",
              color: isAppearanceOpen ? themeColors.accentForeground : themeColors.text,
            }}
          >
            Aa
          </Text>
        </Pressable>
      </View>

      {isAppearanceOpen ? (
        <ReadAlongPopoverBackdrop
          onPress={() => setIsAppearanceOpen(false)}
          offsetTop={-(topInset + 8)}
          offsetLeft={-12}
        />
      ) : null}

      {isAppearanceOpen ? (
        <View
          style={{
            position: "absolute",
            top: topInset + 50,
            right: 12,
            zIndex: 3,
            width: isBookSurface ? 268 : 244,
            gap: 8,
            borderRadius: 16,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
            paddingVertical: 10,
            paddingHorizontal: 10,
            boxShadow: "0 12px 24px rgba(15, 23, 42, 0.18)",
          }}
        >
          {isBookSurface ? (
            <ReadAlongBookAppearance themeColors={themeColors} />
          ) : (
            <>
              <SectionLabel text="Text size" color={themeColors.textMuted} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <StepperButton
                  label="Decrease text size"
                  symbol="-"
                  disabled={fontSize <= MIN_READ_ALONG_FONT_SIZE}
                  onPress={() => setReadAlongFontSize(fontSize - 1)}
                  themeColors={themeColors}
                />
                <Text
                  accessibilityLabel={`Text size ${fontSize}`}
                  style={{
                    minWidth: 28,
                    textAlign: "center",
                    fontSize: 14,
                    color: themeColors.text,
                  }}
                >
                  {fontSize}
                </Text>
                <StepperButton
                  label="Increase text size"
                  symbol="+"
                  disabled={fontSize >= MAX_READ_ALONG_FONT_SIZE}
                  onPress={() => setReadAlongFontSize(fontSize + 1)}
                  themeColors={themeColors}
                />
              </View>

              <View
                style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 2 }}
              />

              <SectionLabel text="Follow position" color={themeColors.textMuted} />
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Follow position"
                style={{ flexDirection: "row", gap: 6 }}
              >
                {READ_ALONG_FOLLOW_ALIGNMENTS.map((alignment) => (
                  <FollowAlignmentOption
                    key={alignment}
                    alignment={alignment}
                    isSelected={alignment === followAlignment}
                    onSelect={setReadAlongFollowAlignment}
                    themeColors={themeColors}
                  />
                ))}
              </View>

              <View
                style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 2 }}
              />

              <SectionLabel text="Words highlighted" color={themeColors.textMuted} />
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Words highlighted"
                style={{ flexDirection: "row", gap: 6 }}
              >
                {READ_ALONG_WORD_HIGHLIGHT_COUNTS.map((count) => (
                  <WordCountOption
                    key={count}
                    count={count}
                    isSelected={count === wordHighlightCount}
                    onSelect={setReadAlongWordHighlightCount}
                    themeColors={themeColors}
                  />
                ))}
              </View>

              <View
                style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 2 }}
              />

              {/* "Word highlight", not "Highlight": the segment block stays on in
                  every style, including None, and the heading has to say so. */}
              <SectionLabel text="Word highlight" color={themeColors.textMuted} />
              <View accessibilityRole="radiogroup" accessibilityLabel="Word highlight">
                {READ_ALONG_WORD_HIGHLIGHT_STYLES.map((style) => (
                  <WordHighlightRow
                    key={style}
                    style={style}
                    isSelected={style === wordHighlightStyle}
                    onSelect={setReadAlongWordHighlightStyle}
                    themeColors={themeColors}
                  />
                ))}
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
};
