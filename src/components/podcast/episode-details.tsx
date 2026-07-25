import HtmlToMarkdown from "@/components/bookComponents/HtmlToMarkdown";
import { useThemeColors } from "@/theme/use-app-theme";
import React from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  title?: string | null;
  description?: string | null;
  maxLines?: number;
};

export const EpisodeDetails = ({ title, description, maxLines = 4 }: Props) => {
  const themeColors = useThemeColors();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const headingTitle = title?.trim() || "Description";
  const trimmedDescription = description?.trim() ?? "";
  const hasDescription = trimmedDescription.length > 0;

  const handleToggle = () => {
    if (!hasDescription) return;
    setIsExpanded((prev) => !prev);
  };

  return (
    <View style={{ gap: 10 }}>
      <Text selectable style={{ fontSize: 16, fontWeight: "600", color: themeColors.text }}>
        {headingTitle}
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
        {hasDescription ? (
          <View
            style={{
              maxHeight: isExpanded ? undefined : maxLines * 20 + 4,
              overflow: "hidden",
            }}
          >
            <HtmlToMarkdown html={trimmedDescription} textColor={themeColors.textMuted} />
          </View>
        ) : (
          <Text selectable style={{ fontSize: 14, lineHeight: 20, color: themeColors.textMuted }}>
            No description available yet.
          </Text>
        )}
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
  );
};
