import { Image } from "expo-image";
import { View, useWindowDimensions } from "react-native";
const fallbackImage = require("../../../assets/images/NoImageFound.png");

type Props = {
  coverURL: string | undefined;
};

const BookImage = ({ coverURL }: Props) => {
  const { width } = useWindowDimensions();
  const imageSize = Math.min(360, width - 48);
  const finalCover = coverURL ? { uri: coverURL } : fallbackImage;

  return (
    <View style={{ alignItems: "center" }}>
      <Image
        source={finalCover}
        style={{
          width: imageSize,
          height: imageSize,
          borderRadius: 24,
          borderCurve: "continuous",
          backgroundColor: "#f3f4f6",
          boxShadow: "0 18px 36px rgba(0, 0, 0, 0.18)",
        }}
        contentFit="cover"
        transition={250}
      />
    </View>
  );
};

export default BookImage;
