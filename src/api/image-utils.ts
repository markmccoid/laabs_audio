import { Image } from "react-native";

export const getImageSize = (uri: string) => {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
};

export const getCoverUri = async (
  coverUrl: string,
): Promise<{ coverUrl: string; type: "passthrough" | "localasset" }> => {
  try {
    await getImageSize(coverUrl);
    return { coverUrl, type: "passthrough" };
  } catch {
    console.log("getCoverUri ERROR-No Cover Found");
  }
  return { coverUrl: "", type: "passthrough" };
};
