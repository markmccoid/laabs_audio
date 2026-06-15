import { buildCoverUrls } from "@/api/cover-urls";
import { useAuthStore } from "@/auth/auth-store";
import { DEFAULT_BOOK_COVER } from "@/constants/default-book-cover";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image, type ImageProps } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

type CoverImageVariant = "thumb" | "full";
type CoverSourceMode = "local" | "remote-tokenless" | "remote-tokened" | "default";

export type CoverImageProps = Omit<ImageProps, "source"> & {
  libraryItemId?: string;
  coverUri?: string | null;
  localCoverUri?: string | null;
  variant?: CoverImageVariant;
  showFavoriteIndicator?: boolean;
  showFinishedIndicator?: boolean;
  showDownloadedIndicator?: boolean;
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

export const resolveCoverImageCandidates = ({
  accessToken,
  coverUri,
  libraryItemId,
  localCoverUri,
  serverUrl,
  variant = "full",
}: {
  accessToken?: string | null;
  libraryItemId?: string;
  coverUri?: string | null;
  localCoverUri?: string | null;
  serverUrl?: string | null;
  variant?: CoverImageVariant;
}) => {
  const localUri =
    localCoverUri?.trim() || (isLocalUri(coverUri) ? coverUri?.trim() : null) || null;

  if (localUri) {
    return {
      localUri,
      tokenlessRemoteUri: null,
      tokenedRemoteUri: null,
    };
  }

  if (libraryItemId && serverUrl) {
    const urls = buildCoverUrls(libraryItemId, { token: accessToken, serverUrl });
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
  const serverUrl = useAuthStore((state) => state.serverUrl);

  const candidates = useMemo(() => {
    return resolveCoverImageCandidates({
      accessToken,
      coverUri,
      libraryItemId,
      localCoverUri,
      serverUrl,
      variant,
    });
  }, [accessToken, coverUri, libraryItemId, localCoverUri, serverUrl, variant]);

  const hasTokenedRemote = Boolean(candidates.tokenedRemoteUri);
  const [mode, setMode] = useState<CoverSourceMode>(() => {
    if (candidates.localUri) return "local";
    if (!candidates.tokenlessRemoteUri) return "default";
    return getPreferredMode(useTokenWithCoverImages, hasTokenedRemote);
  });

  useEffect(() => {
    const nextMode = (() => {
      if (candidates.localUri) {
        return "local";
      }
      if (!candidates.tokenlessRemoteUri) {
        return "default";
      }
      return getPreferredMode(useTokenWithCoverImages, hasTokenedRemote);
    })();

    const frameId = requestAnimationFrame(() => {
      setMode(nextMode);
    });

    return () => cancelAnimationFrame(frameId);
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
        return candidates.tokenedRemoteUri
          ? { uri: candidates.tokenedRemoteUri }
          : DEFAULT_BOOK_COVER;
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
  showFavoriteIndicator = false,
  showFinishedIndicator = false,
  showDownloadedIndicator = false,
  onError,
  style,
  ...props
}: CoverImageProps) => {
  const themeColors = useThemeColors();
  const showFavoriteBadgeOnCovers = useSettingsStore((state) => state.showFavoriteBadgeOnCovers);
  const showFinishedBadgeOnCovers = useSettingsStore((state) => state.showFinishedBadgeOnCovers);
  const resolved = useCoverImageSource({
    libraryItemId,
    coverUri,
    localCoverUri,
    variant,
  });
  const shouldShowFavoriteIndicator = showFavoriteIndicator && showFavoriteBadgeOnCovers;
  const shouldShowFinishedIndicator = showFinishedIndicator && showFinishedBadgeOnCovers;
  const shouldShowDownloadedIndicator = showDownloadedIndicator;

  const handleError: NonNullable<ImageProps["onError"]> = (event) => {
    resolved.onError(event);
    onError?.(event);
  };

  if (
    !shouldShowFinishedIndicator &&
    !shouldShowFavoriteIndicator &&
    !shouldShowDownloadedIndicator
  ) {
    return <Image {...props} style={style} source={resolved.source} onError={handleError} />;
  }

  const flattenedStyle = StyleSheet.flatten(style);
  const indicatorSize = variant === "thumb" ? 20 : 28;
  const indicatorInset = variant === "thumb" ? 6 : 10;

  return (
    <View
      style={[
        flattenedStyle,
        {
          position: flattenedStyle?.position ?? "relative",
          overflow: "hidden",
        },
      ]}
    >
      <Image
        {...props}
        style={StyleSheet.absoluteFill}
        source={resolved.source}
        onError={handleError}
      />
      {shouldShowFavoriteIndicator ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: indicatorInset,
            left: indicatorInset,
            borderRadius: 999,
            borderCurve: "continuous",
            backgroundColor: "rgba(255,255,255,0.82)",
            boxShadow: "0 4px 10px rgba(15, 23, 42, 0.22)",
            paddingHorizontal: 4,
            paddingBottom: 2,
            paddingTop: 4,
          }}
        >
          <SymbolView name="heart.fill" size={indicatorSize} tintColor="#d24d57" />
        </View>
      ) : null}
      {shouldShowFinishedIndicator ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: indicatorInset,
            right: indicatorInset,
            borderRadius: 999,
            borderCurve: "continuous",
            backgroundColor: "rgba(255,255,255,0.82)",
            boxShadow: "0 4px 10px rgba(15, 23, 42, 0.22)",
            paddingHorizontal: 4,
            paddingBottom: 4,
            paddingTop: 3,
          }}
        >
          <SymbolView name="checkmark.circle.fill" size={indicatorSize} tintColor="#008000" />
        </View>
      ) : null}
      {shouldShowDownloadedIndicator ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: indicatorInset,
            left: indicatorInset,
            borderRadius: 999,
            borderCurve: "continuous",
            backgroundColor: "rgba(255,255,255,0.82)",
            boxShadow: "0 4px 10px rgba(15, 23, 42, 0.22)",
            paddingHorizontal: 4,
            paddingBottom: 4,
            paddingTop: 3,
          }}
        >
          <SymbolView name="icloud.fill" size={indicatorSize} tintColor={themeColors.accent} />
        </View>
      ) : null}
    </View>
  );
};
