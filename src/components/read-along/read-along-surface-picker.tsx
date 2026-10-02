/** Chooses among the available Transcript, EPUB, and PDF views of the same audiobook. */

import type { ThemeColors } from "@/theme/use-app-theme";
import { Pressable, Text, View } from "react-native";

export type ReadAlongSurface = "transcript" | "epub" | "pdf";

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
  available: readonly ReadAlongSurface[],
): ReadAlongSurface => {
  const explicit = requested === "book" ? "epub" : requested;
  if (available.includes(explicit as ReadAlongSurface))
    return explicit as ReadAlongSurface;
  return available.includes("epub")
    ? "epub"
    : available.includes("transcript")
      ? "transcript"
      : available.includes("pdf")
        ? "pdf"
        : "transcript";
};

const SEGMENTS: { value: ReadAlongSurface; label: string }[] = [
  { value: "transcript", label: "Transcript" },
  { value: "epub", label: "EPUB" },
  { value: "pdf", label: "PDF" },
];

export const ReadAlongSurfacePicker = ({
  surface,
  available,
  onChange,
  themeColors,
}: {
  surface: ReadAlongSurface;
  available: readonly ReadAlongSurface[];
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
    {SEGMENTS.filter((segment) => available.includes(segment.value)).map(
      (segment) => {
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
                color: isSelected
                  ? themeColors.accentForeground
                  : themeColors.textMuted,
              }}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      },
    )}
  </View>
);
