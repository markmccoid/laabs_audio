import { authStore } from "@/auth/auth-store";
import { buildCoverUrls } from "@/api/cover-urls";
import { createSharedBookLink } from "@/navigation/book-links";
import { settingsStore } from "@/store/settings-store";
import { Share } from "react-native";
import { toast } from "react-native-sonner";

export type ShareBookParams = {
  libraryItemId: string;
  title: string;
  author?: string | null;
  coverUri?: string | null;
  localCoverUri?: string | null;
  version?: string | number | null;
};

const resolveRemoteCoverUri = ({
  libraryItemId,
  version,
}: Pick<ShareBookParams, "libraryItemId" | "version">) => {
  const accessToken = authStore.getState().accessToken;
  const useTokenWithCoverImages = settingsStore.getState().useTokenWithCoverImages;
  const coverUrls = buildCoverUrls(libraryItemId, { token: accessToken, version });

  return useTokenWithCoverImages && coverUrls.fullWithToken ? coverUrls.fullWithToken : coverUrls.full;
};

export const shareBook = async (params: ShareBookParams) => {
  const { libraryItemId, title } = params;
  if (!libraryItemId.trim()) {
    toast.error("Unable to share this book");
    return;
  }

  const deepLink = createSharedBookLink(libraryItemId);

  try {
    const remoteCoverUri = resolveRemoteCoverUri(params);
    await Share.share({
      message: `${title} -> Open in LAAB -> ${deepLink}`,
      url: remoteCoverUri,
    });
  } catch (error) {
    console.warn("[shareBook] Unable to share book", error);
    toast.error("Unable to share book");
  }
};
