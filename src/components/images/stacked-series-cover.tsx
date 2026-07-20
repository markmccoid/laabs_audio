import { CoverImage } from "@/components/images/cover-image";
import { useThemeColors } from "@/theme/use-app-theme";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import type { CompositeCoverGridImage } from "./composite-cover-grid";

type StackedSeriesCoverProps = {
  images: readonly CompositeCoverGridImage[];
  size?: number;
  bookCount?: number;
};

const MAX_COVERS = 3;

export const StackedSeriesCover = ({ images, size = 78, bookCount }: StackedSeriesCoverProps) => {
  const themeColors = useThemeColors();
  const visibleImages = images
    .filter((image) => image.uri || image.libraryItemId || image.coverUri || image.localCoverUri)
    .slice(0, MAX_COVERS);
  const horizontalOffset = Math.max(4, Math.round(size * 0.08));
  const verticalOffset = Math.max(3, Math.round(size * 0.06));
  const underlyingCoverCount = Math.max(0, visibleImages.length - 1);
  const coverWidth = Math.max(1, size - horizontalOffset * underlyingCoverCount);
  const coverHeight = Math.max(1, size - verticalOffset * underlyingCoverCount);
  const countBadge =
    typeof bookCount === "number" ? (
      <View
        pointerEvents="none"
        style={[
          styles.countBadge,
          {
            backgroundColor: themeColors.accent,
            borderColor: themeColors.bg,
          },
        ]}
      >
        <Text
          maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
          selectable
          style={[styles.countBadgeText, { color: themeColors.accentForeground }]}
        >
          {bookCount}
        </Text>
      </View>
    ) : null;

  if (visibleImages.length === 0) {
    return (
      <View
        accessibilityLabel="Series cover"
        style={{
          width: size,
          height: size,
          position: "relative",
        }}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: Math.round(size * 0.2),
              borderCurve: "continuous",
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <SymbolView
            name="books.vertical"
            size={Math.round(size * 0.42)}
            tintColor={themeColors.textMuted}
          />
        </View>
        {countBadge}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Series covers"
      style={{ width: size, height: size, position: "relative" }}
    >
      {visibleImages
        .slice()
        .reverse()
        .map((image, reverseIndex) => {
          const index = visibleImages.length - reverseIndex - 1;
          return (
            <View
              key={image.key ?? image.libraryItemId ?? image.uri ?? index}
              style={{
                position: "absolute",
                left: index * horizontalOffset,
                top: index * verticalOffset,
                width: coverWidth,
                height: coverHeight,
                borderRadius: Math.round(size * 0.12),
                borderCurve: "continuous",
                overflow: "hidden",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
              }}
            >
              <CoverImage
                libraryItemId={image.libraryItemId}
                coverUri={image.coverUri ?? image.uri}
                localCoverUri={image.localCoverUri}
                variant="thumb"
                style={StyleSheet.absoluteFill}
              />
            </View>
          );
        })}
      {countBadge}
    </View>
  );
};

const styles = StyleSheet.create({
  countBadge: {
    position: "absolute",
    top: -7,
    right: -7,
    zIndex: MAX_COVERS + 1,
    minWidth: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 2,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    fontVariant: ["tabular-nums"],
  },
});
