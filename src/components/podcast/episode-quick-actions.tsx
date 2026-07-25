import type { EpisodeIdentity } from "@/podcast/episode-identity";
import { selectIsAnyDownloadActive, useDeviceBooksStore } from "@/store/device-books-store";
import {
  selectHasPlayableEpisodeDownloadForSession,
  selectIsAnotherEpisodeDownloadActive,
  selectIsEpisodeActivelyDownloading,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

type Props = {
  identity: EpisodeIdentity;
  episodeTitle?: string | null;
  podcastTitle?: string | null;
  coverUri?: string | null;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

type DownloadProgressRingProps = {
  progressPercent: number;
  trackColor: string;
  accentColor: string;
};

const DownloadProgressRing = ({
  progressPercent,
  trackColor,
  accentColor,
}: DownloadProgressRingProps) => {
  const clampedPercent = clampPercent(progressPercent);
  const size = 32;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clampedPercent / 100) * circumference;

  return (
    <Svg
      pointerEvents="none"
      width={size}
      height={size}
      style={{
        position: "absolute",
        width: size,
        height: size,
      }}
    >
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={trackColor}
        strokeOpacity={0.35}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={accentColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        fill="none"
        rotation={-90}
        originX={size / 2}
        originY={size / 2}
      />
    </Svg>
  );
};

export const EpisodeQuickActions = ({
  identity,
  episodeTitle,
  podcastTitle,
  coverUri,
}: Props) => {
  const themeColors = useThemeColors();
  const isDownloaded = useDeviceEpisodeDownloadsStore((state) =>
    selectHasPlayableEpisodeDownloadForSession(state, identity),
  );
  const isDownloading = useDeviceEpisodeDownloadsStore((state) =>
    selectIsEpisodeActivelyDownloading(state, identity),
  );
  const isAnotherEpisodeDownloadActive = useDeviceEpisodeDownloadsStore((state) =>
    selectIsAnotherEpisodeDownloadActive(state, identity),
  );
  const isBookDownloadActive = useDeviceBooksStore((state) => selectIsAnyDownloadActive(state));
  const downloadProgress = useDeviceEpisodeDownloadsStore((state) => state.downloadProgress);
  const blockedByOther = isAnotherEpisodeDownloadActive || isBookDownloadActive;
  const progressPercent = isDownloading
    ? clampPercent((downloadProgress?.progress ?? 0) * 100)
    : 0;

  const openDownloads = () => {
    if (!identity.libraryItemId || !identity.episodeId) return;
    if (blockedByOther) return;
    router.push({
      pathname: "/episode-downloads",
      params: {
        libraryItemId: identity.libraryItemId,
        episodeId: identity.episodeId,
        ...(episodeTitle?.trim() ? { episodeTitle: episodeTitle.trim() } : null),
        ...(podcastTitle?.trim() ? { podcastTitle: podcastTitle.trim() } : null),
        ...(coverUri?.trim() ? { coverUri: coverUri.trim() } : null),
      },
    });
  };

  return (
    <View style={{ width: 60, alignItems: "center", gap: 10 }}>
      <Pressable
        onPress={openDownloads}
        disabled={!identity.libraryItemId || !identity.episodeId || blockedByOther}
        accessibilityRole="button"
        accessibilityLabel={
          isDownloading
            ? "Open active download status"
            : blockedByOther
              ? "Another download is in progress"
              : "Open download options"
        }
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity:
            !identity.libraryItemId || !identity.episodeId
              ? 0.45
              : blockedByOther
                ? 0.45
                : pressed
                  ? 0.82
                  : 1,
        })}
      >
        <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
          {isDownloading ? (
            <DownloadProgressRing
              progressPercent={progressPercent}
              trackColor={themeColors.border}
              accentColor={themeColors.accent}
            />
          ) : null}
          <SymbolView
            name={isDownloaded ? "icloud.fill" : "icloud.and.arrow.down"}
            tintColor={isDownloaded || isDownloading ? themeColors.accent : themeColors.text}
            size={25}
          />
        </View>
      </Pressable>
    </View>
  );
};
