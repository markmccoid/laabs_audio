/**
 * The `Aa` popover's Book half.
 *
 * The transcript's rows cannot simply be pointed at Readium. On this surface the
 * app draws none of the text, so "word highlight" has no word to treat and two
 * of its four styles — bold and color — do not exist as Readium decorations at
 * all. Rendering them anyway is how the popover came to be a menu that did
 * nothing on the Book surface in the first place.
 *
 * So this offers what Readium will actually honour, and nothing else. See
 * `epub-reading-preferences.ts` for why each row is shaped the way it is —
 * particularly line spacing, which cannot be offered without giving up the
 * publisher's typography.
 */

import {
  EPUB_FONT_SCALE_STEP,
  EPUB_LINE_HEIGHT_STEP,
  EPUB_PAGE_MARGINS_STEP,
  EPUB_READER_FONTS,
  EPUB_READER_THEMES,
  EPUB_SENTENCE_HIGHLIGHT_STYLES,
  formatEpubFontScale,
  formatEpubRatio,
  MAX_EPUB_FONT_SCALE,
  MAX_EPUB_LINE_HEIGHT,
  MAX_EPUB_PAGE_MARGINS,
  MIN_EPUB_FONT_SCALE,
  MIN_EPUB_LINE_HEIGHT,
  MIN_EPUB_PAGE_MARGINS,
  type EpubReaderFont,
  type EpubReaderTheme,
  type EpubSentenceHighlightStyle,
} from "@/read-along/epub-reading-preferences";
import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import type { ThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

const THEME_LABELS: Record<EpubReaderTheme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  sepia: "Sepia",
};

const FONT_LABELS: Record<EpubReaderFont, string> = {
  publisher: "Publisher",
  serif: "Serif",
  "sans-serif": "Sans",
  OpenDyslexic: "Dyslexic",
};

const SENTENCE_HIGHLIGHT_LABELS: Record<EpubSentenceHighlightStyle, string> = {
  highlight: "Highlight",
  underline: "Underline",
  none: "None",
};

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

/**
 * Module scope, not nested in `StepperRow`. A component defined during render is
 * a fresh type on every render, so React unmounts and remounts it rather than
 * updating it — which throws away press state mid-gesture on a control the
 * reader holds down to step through a range.
 */
const StepButton = ({
  symbol,
  label,
  disabled,
  onPress,
  themeColors,
}: {
  symbol: string;
  label: string;
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
      width: 36,
      height: 32,
      borderRadius: 9,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: themeColors.bg,
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    })}
  >
    <Text style={{ fontSize: 17, fontWeight: "700", color: themeColors.text }}>{symbol}</Text>
  </Pressable>
);

const StepperRow = ({
  label,
  value,
  atMin,
  atMax,
  disabled,
  onDecrease,
  onIncrease,
  themeColors,
}: {
  label: string;
  value: string;
  atMin: boolean;
  atMax: boolean;
  disabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  themeColors: ThemeColors;
}) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: disabled ? 0.4 : 1 }}>
    <Text style={{ flex: 1, fontSize: 14, color: themeColors.text }}>{label}</Text>
    <StepButton
      symbol="-"
      label={`Decrease ${label.toLowerCase()}`}
      disabled={Boolean(disabled) || atMin}
      onPress={onDecrease}
      themeColors={themeColors}
    />
    <Text
      accessibilityLabel={`${label} ${value}`}
      style={{ minWidth: 44, textAlign: "center", fontSize: 13, color: themeColors.text }}
    >
      {value}
    </Text>
    <StepButton
      symbol="+"
      label={`Increase ${label.toLowerCase()}`}
      disabled={Boolean(disabled) || atMax}
      onPress={onIncrease}
      themeColors={themeColors}
    />
  </View>
);

/**
 * A row of mutually exclusive chips. Used rather than the transcript's stacked
 * radio rows because these sets are four wide and carry no preview — a style
 * that can show itself deserves a row of its own, and one that cannot does not.
 */
const ChipGroup = <T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  themeColors,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
  themeColors: ThemeColors;
}) => (
  <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 6 }}>
    <SectionLabel text={label} color={themeColors.textMuted} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((option) => {
        const isSelected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={labels[option]}
            accessibilityState={{ selected: isSelected, checked: isSelected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => ({
              paddingHorizontal: 11,
              paddingVertical: 6,
              borderRadius: 999,
              borderCurve: "continuous",
              backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: isSelected ? themeColors.accentForeground : themeColors.textMuted,
              }}
            >
              {labels[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

export const ReadAlongBookAppearance = ({ themeColors }: { themeColors: ThemeColors }) => {
  const fontScale = useSettingsStore((state) => state.readAlongEpubFontScale);
  const theme = useSettingsStore((state) => state.readAlongEpubTheme);
  const font = useSettingsStore((state) => state.readAlongEpubFont);
  const pageMargins = useSettingsStore((state) => state.readAlongEpubPageMargins);
  const lineHeight = useSettingsStore((state) => state.readAlongEpubLineHeight);
  const publisherStyles = useSettingsStore((state) => state.readAlongEpubPublisherStyles);
  const sentenceHighlightStyle = useSettingsStore(
    (state) => state.readAlongEpubSentenceHighlightStyle,
  );

  const {
    setReadAlongEpubFontScale,
    setReadAlongEpubTheme,
    setReadAlongEpubFont,
    setReadAlongEpubPageMargins,
    setReadAlongEpubLineHeight,
    setReadAlongEpubPublisherStyles,
    setReadAlongEpubSentenceHighlightStyle,
  } = useSettingsActions();

  const divider = (
    <View style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 2 }} />
  );

  return (
    <>
      <SectionLabel text="Text size" color={themeColors.textMuted} />
      <StepperRow
        label="Size"
        value={formatEpubFontScale(fontScale)}
        atMin={fontScale <= MIN_EPUB_FONT_SCALE}
        atMax={fontScale >= MAX_EPUB_FONT_SCALE}
        onDecrease={() => setReadAlongEpubFontScale(fontScale - EPUB_FONT_SCALE_STEP)}
        onIncrease={() => setReadAlongEpubFontScale(fontScale + EPUB_FONT_SCALE_STEP)}
        themeColors={themeColors}
      />
      <StepperRow
        label="Margins"
        value={formatEpubRatio(pageMargins)}
        atMin={pageMargins <= MIN_EPUB_PAGE_MARGINS}
        atMax={pageMargins >= MAX_EPUB_PAGE_MARGINS}
        onDecrease={() => setReadAlongEpubPageMargins(pageMargins - EPUB_PAGE_MARGINS_STEP)}
        onIncrease={() => setReadAlongEpubPageMargins(pageMargins + EPUB_PAGE_MARGINS_STEP)}
        themeColors={themeColors}
      />

      {divider}

      <ChipGroup
        label="Theme"
        options={EPUB_READER_THEMES}
        labels={THEME_LABELS}
        value={theme}
        onChange={setReadAlongEpubTheme}
        themeColors={themeColors}
      />

      <ChipGroup
        label="Font"
        options={EPUB_READER_FONTS}
        labels={FONT_LABELS}
        value={font}
        onChange={setReadAlongEpubFont}
        themeColors={themeColors}
      />

      {divider}

      {/* The coupling is stated rather than hidden. Readium ignores lineHeight
          while publisher styles are on, so a "Line spacing" stepper that quietly
          switched them off would trade the book's whole typography for a nudge
          the reader thought was local. */}
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Publisher typography"
        accessibilityState={{ checked: publisherStyles }}
        onPress={() => setReadAlongEpubPublisherStyles(!publisherStyles)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, color: themeColors.text }}>Publisher typography</Text>
          <Text style={{ fontSize: 11, color: themeColors.textMuted, marginTop: 1 }}>
            {publisherStyles ? "Turn off to set line spacing" : "Using your own line spacing"}
          </Text>
        </View>
        <View style={{ width: 16, alignItems: "center" }}>
          {publisherStyles ? (
            <SymbolView name="checkmark" size={13} tintColor={themeColors.accent} />
          ) : null}
        </View>
      </Pressable>

      <StepperRow
        label="Line spacing"
        value={formatEpubRatio(lineHeight)}
        atMin={lineHeight <= MIN_EPUB_LINE_HEIGHT}
        atMax={lineHeight >= MAX_EPUB_LINE_HEIGHT}
        disabled={publisherStyles}
        onDecrease={() => setReadAlongEpubLineHeight(lineHeight - EPUB_LINE_HEIGHT_STEP)}
        onIncrease={() => setReadAlongEpubLineHeight(lineHeight + EPUB_LINE_HEIGHT_STEP)}
        themeColors={themeColors}
      />

      {divider}

      {/* "Sentence", not "Word": on this surface the lit unit is a whole Text
          Unit, and the heading has to say what will actually light up. */}
      <ChipGroup
        label="Sentence highlight"
        options={EPUB_SENTENCE_HIGHLIGHT_STYLES}
        labels={SENTENCE_HIGHLIGHT_LABELS}
        value={sentenceHighlightStyle}
        onChange={setReadAlongEpubSentenceHighlightStyle}
        themeColors={themeColors}
      />
    </>
  );
};
