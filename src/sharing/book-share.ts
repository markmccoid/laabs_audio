import { authStore } from "@/auth/auth-store";
import { resolveCoverImageCandidates } from "@/components/images/cover-image";
import { createSharedBookLink } from "@/navigation/book-links";
import { settingsStore } from "@/store/settings-store";
import { Image as ExpoImage } from "expo-image";
import { Share } from "react-native";
import { toast } from "react-native-sonner";

export type ShareBookParams = {
  libraryItemId: string;
  title: string;
  author?: string | null;
  coverUri?: string | null;
  localCoverUri?: string | null;
};

const ensureShareableUri = (value: string) =>
  value.startsWith("/") ? `file://${value}` : value;

const resolveCachedCoverUri = async ({
  coverUri,
  libraryItemId,
  localCoverUri,
}: Pick<ShareBookParams, "coverUri" | "libraryItemId" | "localCoverUri">) => {
  if (localCoverUri?.trim()) {
    return ensureShareableUri(localCoverUri.trim());
  }

  const accessToken = authStore.getState().accessToken;
  const useTokenWithCoverImages = settingsStore.getState().useTokenWithCoverImages;
  const candidates = resolveCoverImageCandidates({
    accessToken,
    coverUri,
    libraryItemId,
    localCoverUri,
    variant: "full",
  });

  const remoteCoverUri =
    useTokenWithCoverImages && candidates.tokenedRemoteUri
      ? candidates.tokenedRemoteUri
      : candidates.tokenlessRemoteUri;

  if (!remoteCoverUri) {
    return null;
  }

  const cachedPath = await ExpoImage.getCachePathAsync(remoteCoverUri);
  return cachedPath ? ensureShareableUri(cachedPath) : null;
};

export const shareBook = async (params: ShareBookParams) => {
  const { libraryItemId, title } = params;
  if (!libraryItemId.trim()) {
    toast.error("Unable to share this book");
    return;
  }

  const deepLink = createSharedBookLink(libraryItemId);

  try {
    const cachedCoverUri = await resolveCachedCoverUri(params);
    await Share.share({
      message: `${title} -> Open in LAAB -> ${deepLink}`,
      url: cachedCoverUri ?? undefined,
    });
  } catch (error) {
    console.warn("[shareBook] Unable to share book", error);
    toast.error("Unable to share book");
  }
};
