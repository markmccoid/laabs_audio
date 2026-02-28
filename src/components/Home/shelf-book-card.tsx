import type { LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { usePlaybackStore } from "@/player";
import { selectHasPlayableBookDownload, useDeviceBooksStore } from "@/store/device-books-store";
import { resolvePreferredCoverUri } from "@/store/downloaded-book-helpers";
import type { BookProgressTimeDisplay } from "@/store/settings-store";
import { useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const COVER_SIZE = 160;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatDurationBadge = (durationSeconds?: number | null) => {
  const seconds = Math.max(0, Math.floor(durationSeconds ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m`;
};

type ShelfBookCardProps = {
  book: LibraryItemSummary;
  progress?: UserBookProgress;
  isOffline: boolean;
};

export const ShelfBookCard = ({ book, progress, isOffline }: ShelfBookCardProps) => {
  const themeColors = useThemeColors();
  const defaultProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const isActivePlaybackBook = usePlaybackStore((state) => state.libraryItemId === book.id);
  const activePlaybackPositionMs = usePlaybackStore((state) =>
    state.libraryItemId === book.id ? state.positionMs : 0,
  );
  const activePlaybackDurationMs = usePlaybackStore((state) =>
    state.libraryItemId === book.id ? state.durationMs : 0,
  );
  const [progressDisplay, setProgressDisplay] = useState<BookProgressTimeDisplay>(
    defaultProgressTimeDisplay,
  );
  const isDownloaded = useDeviceBooksStore((state) =>
    selectHasPlayableBookDownload(state, book.id),
  );
  const coverLocalUri = useDeviceBooksStore((state) =>
    state.downloadedBookData[book.id]?.coverLocalUri ?? null,
  );
  const showOfflineUnavailable = isOffline && !isDownloaded;
  const coverSource = resolvePreferredCoverUri(coverLocalUri, book.cover) ?? book.cover;
  const activePlaybackSeconds = Math.max(0, Math.floor(activePlaybackPositionMs / 1000));
  const activePlaybackDurationSeconds = Math.max(0, Math.floor(activePlaybackDurationMs / 1000));
  const durationSeconds = Math.max(
    0,
    Math.floor(progress?.duration ?? book.duration ?? 0),
    activePlaybackDurationSeconds,
  );
  const rawProgressSeconds = Math.max(
    0,
    Math.floor(progress?.currentTime ?? 0),
    isActivePlaybackBook ? activePlaybackSeconds : 0,
  );
  const progressSeconds =
    durationSeconds > 0 ? clamp(rawProgressSeconds, 0, durationSeconds) : rawProgressSeconds;
  const progressPercent = durationSeconds > 0 ? progressSeconds / durationSeconds : 0;
  const visualProgressPercent = progress?.isFinished ? 1 : progressPercent;
  const showProgressLabel =
    durationSeconds > 0 && (progressSeconds > 0 || Boolean(progress?.isFinished));
  const elapsedLabel = formatDurationBadge(
    progress?.isFinished ? durationSeconds : progressSeconds,
  );
  const remainingLabel = `${formatDurationBadge(Math.max(durationSeconds - progressSeconds, 0))} left`;
  const progressLabel = progressDisplay === "elapsed" ? elapsedLabel : remainingLabel;
  const isElapsedView = progressDisplay === "elapsed";

  useEffect(() => {
    setProgressDisplay(defaultProgressTimeDisplay);
  }, [defaultProgressTimeDisplay, book.id]);

  return (
    <Link
      href={{
        pathname: "/(tabs)/(home)/[libraryItemId]",
        params: { libraryItemId: book.id },
      }}
      asChild
    >
      <Pressable
        style={{
          width: COVER_SIZE,
          gap: 7,
        }}
      >
        <View style={{ width: COVER_SIZE, height: COVER_SIZE }}>
          <Image
            source={coverSource}
            style={{
              width: COVER_SIZE,
              height: COVER_SIZE,
              borderRadius: 16,
              borderWidth: StyleSheet.hairlineWidth,
              backgroundColor: themeColors.surface,
              opacity: showOfflineUnavailable ? 0.55 : 1,
            }}
          />
          {showOfflineUnavailable ? (
            <View
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                width: 22,
                height: 22,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="wifi.slash" size={12} tintColor={themeColors.textMuted} />
            </View>
          ) : null}
        </View>
        <View
          style={{
            width: COVER_SIZE,
            height: 5,
            borderRadius: 999,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: "rgba(148, 163, 184, 0.35)",
          }}
        >
          <View
            style={{
              width: `${visualProgressPercent * 100}%`,
              height: "100%",
              backgroundColor: themeColors.accent,
            }}
          />
        </View>
        <Text
          selectable
          numberOfLines={1}
          style={{ color: themeColors.text, fontSize: 11, fontWeight: "600", lineHeight: 16 }}
        >
          {book.title}
        </Text>
        {showProgressLabel ? (
          <View className="flex-row justify-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle progress display"
              onPress={() =>
                setProgressDisplay((current) => (current === "elapsed" ? "remaining" : "elapsed"))
              }
              style={({ pressed }) => ({
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: isElapsedView ? themeColors.accent : themeColors.border,
                backgroundColor: isElapsedView ? themeColors.accent : themeColors.bg,
                paddingHorizontal: 9,
                paddingVertical: 5,
                opacity: pressed ? 0.82 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                alignSelf: "flex-start",
                boxShadow: isElapsedView ? "0 6px 14px rgba(15, 23, 42, 0.18)" : undefined,
              })}
            >
              <SymbolView
                name={progressDisplay === "elapsed" ? "gauge.with.needle.fill" : "hourglass"}
                size={13}
                tintColor={isElapsedView ? themeColors.bg : themeColors.textMuted}
              />
              <Text
                selectable
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  color: isElapsedView ? themeColors.bg : themeColors.textMuted,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {progressLabel}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
};
