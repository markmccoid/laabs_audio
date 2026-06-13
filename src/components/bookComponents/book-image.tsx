import { CoverImage } from "@/components/images/cover-image";
import { useThemeColors } from "@/theme/use-app-theme";
import type { ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

type Props = {
  libraryItemId?: string;
  coverURL: string | undefined;
  localCoverUri?: string | null;
  leftAccessory?: ReactNode;
  maxSize?: number;
  progressPercent?: number;
  showFavoriteIndicator?: boolean;
  showProgressLine?: boolean;
  showFinishedIndicator?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const BookImage = ({
  libraryItemId,
  coverURL,
  localCoverUri,
  leftAccessory,
  maxSize = 360,
  progressPercent = 0,
  showFavoriteIndicator = false,
  showProgressLine = false,
  showFinishedIndicator = false,
}: Props) => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const imageSize = Math.min(maxSize, width - 48);
  const resolvedProgressPercent = clamp(progressPercent, 0, 1);

  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          width: imageSize,
          height: imageSize,
          position: "relative",
          margin: -2,
        }}
      >
        <CoverImage
          libraryItemId={libraryItemId}
          coverUri={coverURL}
          localCoverUri={localCoverUri}
          variant="full"
          showFavoriteIndicator={showFavoriteIndicator}
          showFinishedIndicator={showFinishedIndicator}
          style={{
            width: imageSize,
            height: imageSize,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: "black",
            // borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
          }}
          contentFit="cover"
          transition={250}
        />

        {leftAccessory ? (
          <View
            style={{
              position: "absolute",
              left: -32,
              top: imageSize / 2 - 25,
            }}
          >
            {leftAccessory}
          </View>
        ) : null}
      </View>
      {showProgressLine ? (
        <View
          style={{
            width: imageSize,
            height: 4,
            borderRadius: 999,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: "rgba(148, 163, 184, 0.35)",
            marginTop: 8,
          }}
        >
          <View
            style={{
              width: `${resolvedProgressPercent * 100}%`,
              height: "100%",
              backgroundColor: themeColors.accent,
            }}
          />
        </View>
      ) : null}
    </View>
  );
};

export default BookImage;
