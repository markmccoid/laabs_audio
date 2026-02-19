import type { ReactNode } from "react";
import { Image } from "expo-image";
import { useThemeColors } from "@/theme/use-app-theme";
import { View, useWindowDimensions } from "react-native";
const fallbackImage = require("../../../assets/images/NoImageFound.png");

type Props = {
  coverURL: string | undefined;
  leftAccessory?: ReactNode;
};

const BookImage = ({ coverURL, leftAccessory }: Props) => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const imageSize = Math.min(360, width - 48);
  const finalCover = coverURL ? { uri: coverURL } : fallbackImage;

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: imageSize, height: imageSize, position: "relative" }}>
        <Image
          source={finalCover}
          style={{
            width: imageSize,
            height: imageSize,
            borderRadius: 24,
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
    </View>
  );
};

export default BookImage;
