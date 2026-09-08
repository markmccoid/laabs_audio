/**
 * The control that chooses which Read-Along surface is showing.
 *
 * Read-Along is the umbrella; Transcript Read-Along shows the words the narrator
 * said and EPUB Read-Along shows the words the book says (CONTEXT.md, ADR-0039).
 * They are two views of one reading position, so this is a switch inside the
 * screen rather than two routes — a reader comparing the publisher's text
 * against the ASR text should not have to leave and come back.
 *
 * It sits at the top deliberately: swipes that start inside the Readium panel
 * are swallowed by the WebView and turn pages instead.
 */

import type { ThemeColors } from "@/theme/use-app-theme";
import { Pressable, Text, View } from "react-native";

export type ReadAlongSurface = "transcript" | "book";

/**
 * Which surface to open on.
 *
 * Prefers the EPUB when the book has an Alignment Map, because that is the
 * better reading experience when it exists — the publisher's own typesetting
 * rather than machine transcription. An explicit request always wins, and a
 * request for a surface the book cannot offer falls back rather than showing an
 * empty one.
 */
export const initialReadAlongSurface = (
  requested: string | null | undefined,
  hasMap: boolean,
): ReadAlongSurface => {
  if (requested === "transcript") return "transcript";
  if (requested === "book") return hasMap ? "book" : "transcript";
  return hasMap ? "book" : "transcript";
};

const SEGMENTS: { value: ReadAlongSurface; label: string }[] = [
  { value: "transcript", label: "Transcript" },
  { value: "book", label: "Book" },
];

export const ReadAlongSurfacePicker = ({
  surface,
  onChange,
  themeColors,
}: {
  surface: ReadAlongSurface;
  onChange: (next: ReadAlongSurface) => void;
  themeColors: ThemeColors;
}) => (
  <View
    style={{
      flexDirection: "row",
      alignSelf: "center",
      marginBottom: 8,
      padding: 2,
      borderRadius: 999,
      backgroundColor: themeColors.surface,
      borderWidth: 1,
      borderColor: themeColors.border,
    }}
  >
    {SEGMENTS.map((segment) => {
      const isSelected = surface === segment.value;
      return (
        <Pressable
          key={segment.value}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={`Show ${segment.label}`}
          onPress={() => onChange(segment.value)}
          style={{
            paddingHorizontal: 18,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: isSelected ? themeColors.accent : "transparent",
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: isSelected ? themeColors.accentForeground : themeColors.textMuted,
            }}
          >
            {segment.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);
