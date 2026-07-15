import { CoverImage } from "@/components/images/cover-image";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";
import type { CompositeCoverGridImage } from "./composite-cover-grid";

type StackedSeriesCoverProps = {
  images: readonly CompositeCoverGridImage[];
  size?: number;
};

const MAX_COVERS = 4;

export const StackedSeriesCover = ({ images, size = 78 }: StackedSeriesCoverProps) => {
  const themeColors = useThemeColors();
  const visibleImages = images
    .filter((image) => image.uri || image.libraryItemId || image.coverUri || image.localCoverUri)
    .slice(0, MAX_COVERS);
  const coverWidth = Math.round(size * 0.58);
  const coverHeight = Math.round(size * 0.9);
  const offset = Math.max(5, Math.round(size * 0.14));

  if (visibleImages.length === 0) {
    return (
      <View
        accessibilityLabel="Series cover"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.2),
          borderCurve: "continuous",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: themeColors.border,
          backgroundColor: themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SymbolView name="books.vertical" size={Math.round(size * 0.42)} tintColor={themeColors.textMuted} />
      </View>
    );
  }

  return (
    <View accessibilityLabel="Series covers" style={{ width: size, height: size, position: "relative" }}>
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
                left: index * offset,
                top: Math.round((size - coverHeight) / 2),
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
    </View>
  );
};
