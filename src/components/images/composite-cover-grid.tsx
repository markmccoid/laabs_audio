import { CoverImage } from "@/components/images/cover-image";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

export type CompositeCoverGridImage = {
  key?: string;
  uri?: string | null;
  libraryItemId?: string;
  coverUri?: string | null;
  localCoverUri?: string | null;
  accessibilityLabel?: string;
};

type CompositeCoverGridProps = {
  images?: readonly CompositeCoverGridImage[];
  imageUris?: readonly (string | null | undefined)[];
  size?: number;
  borderRadius?: number;
  gap?: number;
  fallbackSystemName?: SFSymbol;
  fallbackAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const QUADRANT_COUNT = 4;
const EMPTY_IMAGES: readonly CompositeCoverGridImage[] = [];

const hasRenderableImage = (image: CompositeCoverGridImage) =>
  Boolean(image.uri || image.libraryItemId || image.coverUri || image.localCoverUri);

const normalizeImages = (
  images?: readonly CompositeCoverGridImage[],
  imageUris?: readonly (string | null | undefined)[],
) => images ?? imageUris?.map((uri) => ({ uri })) ?? EMPTY_IMAGES;

const getImageKey = (image: CompositeCoverGridImage | undefined, fallback: string) =>
  image?.key ?? image?.libraryItemId ?? image?.uri ?? fallback;

const CompositeCoverSlot = ({ image }: { image?: CompositeCoverGridImage }) => {
  if (!image) return null;

  if (image.libraryItemId || image.coverUri || image.localCoverUri) {
    return (
      <CoverImage
        accessibilityLabel={image.accessibilityLabel}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={150}
        libraryItemId={image.libraryItemId}
        coverUri={image.coverUri ?? image.uri}
        localCoverUri={image.localCoverUri}
        variant="thumb"
        style={StyleSheet.absoluteFill}
      />
    );
  }

  if (!image.uri) return null;

  return (
    <Image
      accessibilityLabel={image.accessibilityLabel}
      cachePolicy="memory-disk"
      contentFit="cover"
      recyclingKey={image.uri}
      source={{ uri: image.uri }}
      style={StyleSheet.absoluteFill}
      transition={150}
    />
  );
};

export const CompositeCoverGrid = ({
  images,
  imageUris,
  size = 52,
  borderRadius = Math.max(10, Math.round(size * 0.22)),
  gap = 1,
  fallbackSystemName = "books.vertical",
  fallbackAccessibilityLabel = "Composite cover",
  style,
}: CompositeCoverGridProps) => {
  const themeColors = useThemeColors();
  const visibleImages = normalizeImages(images, imageUris)
    .filter(hasRenderableImage)
    .slice(0, QUADRANT_COUNT);

  if (visibleImages.length === 0) {
    return (
      <View
        accessibilityLabel={fallbackAccessibilityLabel}
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius,
            backgroundColor: themeColors.bg,
            borderColor: themeColors.border,
          },
          style,
        ]}
      >
        <SymbolView
          name={fallbackSystemName}
          size={Math.round(size * 0.42)}
          tintColor={themeColors.textMuted}
        />
      </View>
    );
  }

  const slots = Array.from({ length: QUADRANT_COUNT }, (_value, index) => visibleImages[index]);

  return (
    <View
      accessibilityLabel={fallbackAccessibilityLabel}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: themeColors.border,
          borderColor: themeColors.border,
        },
        style,
      ]}
    >
      <View style={[styles.row, { gap }]}>
        {slots.slice(0, 2).map((image, index) => (
          <View
            key={getImageKey(image, `top-empty-${index}`)}
            style={[styles.quadrant, { backgroundColor: themeColors.bg }]}
          >
            <CompositeCoverSlot image={image} />
          </View>
        ))}
      </View>
      <View style={[styles.row, { gap, marginTop: gap }]}>
        {slots.slice(2, 4).map((image, index) => (
          <View
            key={getImageKey(image, `bottom-empty-${index}`)}
            style={[styles.quadrant, { backgroundColor: themeColors.bg }]}
          >
            <CompositeCoverSlot image={image} />
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    overflow: "hidden",
  },
  quadrant: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  row: {
    flex: 1,
    flexDirection: "row",
    width: "100%",
  },
});
