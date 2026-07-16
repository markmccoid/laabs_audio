import {
  CompositeCoverGrid,
  type CompositeCoverGridImage,
} from "@/components/images/composite-cover-grid";
import { useThemeColors } from "@/theme/use-app-theme";
import type { SFSymbol } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

type LibraryGroupGridItemProps = {
  title: string;
  countLabel: string;
  coverImages: readonly CompositeCoverGridImage[];
  coverSize: number;
  fallbackSystemName: SFSymbol;
  onPress: () => void;
};

export const LibraryGroupGridItem = memo(function LibraryGroupGridItem({
  title,
  countLabel,
  coverImages,
  coverSize,
  fallbackSystemName,
  onPress,
}: LibraryGroupGridItemProps) {
  const themeColors = useThemeColors();

  return (
    <Pressable
      accessibilityLabel={`${title}, ${countLabel}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.container, { opacity: pressed ? 0.72 : 1 }]}
    >
      <CompositeCoverGrid
        images={coverImages}
        fallbackSystemName={fallbackSystemName}
        size={coverSize}
      />
      <Text
        numberOfLines={2}
        selectable
        style={[styles.title, { color: themeColors.text }]}
      >
        {title}
      </Text>
      <Text
        numberOfLines={1}
        selectable
        style={[styles.count, { color: themeColors.textMuted }]}
      >
        {countLabel}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
    paddingBottom: 18,
  },
  title: {
    width: "100%",
    minHeight: 36,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  count: {
    width: "100%",
    fontSize: 12,
    lineHeight: 15,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
