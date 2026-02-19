import React from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/use-app-theme";

type Props = {
  description?: string | null;
  genres?: string[];
  tags?: string[];
  maxLines?: number;
};

const BookDetails = ({ description, genres, tags, maxLines = 4 }: Props) => {
  const themeColors = useThemeColors();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const trimmedDescription = description?.trim() ?? "";
  const hasDescription = trimmedDescription.length > 0;
  const resolvedGenres = genres ?? [];
  const resolvedTags = tags ?? [];
  const hasGenres = resolvedGenres.length > 0;
  const hasTags = resolvedTags.length > 0;

  const handleToggle = () => {
    if (!hasDescription) return;
    setIsExpanded((prev) => !prev);
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 10 }}>
        <Text selectable style={{ fontSize: 18, fontWeight: "600", color: themeColors.text }}>
          Description
        </Text>
        <Pressable
          onPress={handleToggle}
          disabled={!hasDescription}
          style={({ pressed }) => ({
            borderRadius: 18,
            borderCurve: "continuous",
            backgroundColor: themeColors.surface,
            padding: 14,
            borderWidth: 1,
            borderColor: themeColors.border,
            boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text
            selectable
            style={{ fontSize: 14, lineHeight: 20, color: themeColors.textMuted }}
            numberOfLines={isExpanded ? undefined : maxLines}
          >
            {hasDescription ? trimmedDescription : "No description available yet."}
          </Text>
          {hasDescription ? (
            <Text selectable style={{ marginTop: 8, fontSize: 12, color: themeColors.textMuted }}>
              {isExpanded ? "Tap to collapse" : "Tap to expand"}
            </Text>
          ) : (
            <Text selectable style={{ marginTop: 8, fontSize: 12, color: themeColors.textMuted }}>
              Description will appear here when available.
            </Text>
          )}
        </Pressable>
      </View>

      <View style={{ gap: 10 }}>
        <Text selectable style={{ fontSize: 16, fontWeight: "600", color: themeColors.text }}>
          Genres
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {hasGenres ? (
            resolvedGenres.map((genre, index) => (
              <View
                key={`${genre}-${index}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: themeColors.surface,
                  borderWidth: 1,
                  borderColor: themeColors.accent,
                }}
              >
                <Text selectable style={{ fontSize: 12, color: themeColors.accent }}>
                  {genre}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={{ fontSize: 13, color: themeColors.textMuted }}>
              No genres listed.
            </Text>
          )}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text selectable style={{ fontSize: 16, fontWeight: "600", color: themeColors.text }}>
          Tags
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {hasTags ? (
            resolvedTags.map((tag, index) => (
              <View
                key={`${tag}-${index}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: themeColors.surface,
                  borderWidth: 1,
                  borderColor: themeColors.accent,
                }}
              >
                <Text selectable style={{ fontSize: 12, color: themeColors.accent }}>
                  {tag}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={{ fontSize: 13, color: themeColors.textMuted }}>
              No tags listed.
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

export default BookDetails;
