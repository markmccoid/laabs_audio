import { useAuthStore } from "@/auth/auth-store";
import { buildCoverUrls } from "@/api/cover-urls";
import { DEFAULT_BOOK_COVER } from "@/constants/default-book-cover";
import { useSettingsStore } from "@/store/settings-store";
import { Image, type ImageProps } from "expo-image";
import { useEffect, useMemo, useState } from "react";

type CoverImageVariant = "thumb" | "full";
type CoverSourceMode = "local" | "remote-tokenless" | "remote-tokened" | "default";

export type CoverImageProps = Omit<ImageProps, "source"> & {
  libraryItemId?: string;
  coverUri?: string | null;
  localCoverUri?: string | null;
  variant?: CoverImageVariant;
};

const isLocalUri = (value?: string | null) =>
  typeof value === "string" &&
  (value.startsWith("file://") || value.startsWith("/") || value.startsWith("data:"));

const getPreferredMode = (preferTokened: boolean, hasTokenedRemote: boolean): CoverSourceMode => {
  if (preferTokened && hasTokenedRemote) {
    return "remote-tokened";
  }
  return "remote-tokenless";
};

export const useCoverImageSource = ({
  libraryItemId,
  coverUri,
  localCoverUri,
  variant = "full",
}: {
  libraryItemId?: string;
  coverUri?: string | null;
  localCoverUri?: string | null;
  variant?: CoverImageVariant;
}) => {
  const useTokenWithCoverImages = useSettingsStore((state) => state.useTokenWithCoverImages);
  const accessToken = useAuthStore((state) => state.accessToken);

  const candidates = useMemo(() => {
    const localUri = localCoverUri?.trim() || (isLocalUri(coverUri) ? coverUri?.trim() : null) || null;

    if (localUri) {
      return {
        localUri,
        tokenlessRemoteUri: null,
        tokenedRemoteUri: null,
      };
    }

    if (libraryItemId) {
      const urls = buildCoverUrls(libraryItemId, { token: accessToken });
      return {
        localUri: null,
        tokenlessRemoteUri: variant === "thumb" ? urls.thumb : urls.full,
        tokenedRemoteUri: variant === "thumb" ? urls.thumbWithToken : urls.fullWithToken,
      };
    }

    return {
      localUri: null,
      tokenlessRemoteUri: coverUri?.trim() || null,
      tokenedRemoteUri: null,
    };
  }, [accessToken, coverUri, libraryItemId, localCoverUri, variant]);

  const hasTokenedRemote = Boolean(candidates.tokenedRemoteUri);
  const [mode, setMode] = useState<CoverSourceMode>(() => {
    if (candidates.localUri) return "local";
    if (!candidates.tokenlessRemoteUri) return "default";
    return getPreferredMode(useTokenWithCoverImages, hasTokenedRemote);
  });

  useEffect(() => {
    if (candidates.localUri) {
      setMode("local");
      return;
    }
    if (!candidates.tokenlessRemoteUri) {
      setMode("default");
      return;
    }
    setMode(getPreferredMode(useTokenWithCoverImages, hasTokenedRemote));
  }, [
    candidates.localUri,
    candidates.tokenlessRemoteUri,
    hasTokenedRemote,
    useTokenWithCoverImages,
  ]);

  const source = useMemo(() => {
    switch (mode) {
      case "local":
        return candidates.localUri ? { uri: candidates.localUri } : DEFAULT_BOOK_COVER;
      case "remote-tokened":
        return candidates.tokenedRemoteUri ? { uri: candidates.tokenedRemoteUri } : DEFAULT_BOOK_COVER;
      case "remote-tokenless":
        return candidates.tokenlessRemoteUri
          ? { uri: candidates.tokenlessRemoteUri }
          : DEFAULT_BOOK_COVER;
      case "default":
      default:
        return DEFAULT_BOOK_COVER;
    }
  }, [candidates.localUri, candidates.tokenedRemoteUri, candidates.tokenlessRemoteUri, mode]);

  const onError: NonNullable<ImageProps["onError"]> = () => {
    if (mode === "local") {
      setMode("default");
      return;
    }
    if (
      mode === "remote-tokenless" &&
      candidates.tokenedRemoteUri &&
      candidates.tokenedRemoteUri !== candidates.tokenlessRemoteUri
    ) {
      setMode("remote-tokened");
      return;
    }
    setMode("default");
  };

  return { source, onError };
};

export const CoverImage = ({
  libraryItemId,
  coverUri,
  localCoverUri,
  variant = "full",
  onError,
  ...props
}: CoverImageProps) => {
  const resolved = useCoverImageSource({
    libraryItemId,
    coverUri,
    localCoverUri,
    variant,
  });

  const handleError: NonNullable<ImageProps["onError"]> = (event) => {
    resolved.onError(event);
    onError?.(event);
  };

  return <Image {...props} source={resolved.source} onError={handleError} />;
};
