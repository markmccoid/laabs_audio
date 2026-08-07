import type { BookProgressTimeDisplay } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  podcastTitle?: string | null;
  publishedLabel?: string | null;
  durationSeconds?: number | null;
  progressSeconds?: number | null;
  remainingSeconds?: number | null;
  isInProgress?: boolean;
  defaultProgressTimeDisplay?: BookProgressTimeDisplay;
  progressResetKey?: string;
  onPodcastPress?: () => void;
};

type EpisodeProgressPillProps = {
  progressSeconds?: number | null;
  remainingSeconds?: number | null;
  defaultProgressTimeDisplay?: BookProgressTimeDisplay;
  progressResetKey?: string;
};

const formatDurationBadge = (durationSeconds?: number | null) => {
  const seconds = Math.max(0, Math.floor(durationSeconds ?? 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m`;
};

export const EpisodeProgressPill = ({
  progressSeconds,
  remainingSeconds,
  defaultProgressTimeDisplay = "elapsed",
  progressResetKey,
}: EpisodeProgressPillProps) => {
  const themeColors = useThemeColors();
  const [progressSelection, setProgressSelection] = useState<{
    defaultDisplay: BookProgressTimeDisplay;
    display: BookProgressTimeDisplay;
    resetKey?: string;
  }>(() => ({
    defaultDisplay: defaultProgressTimeDisplay,
    display: defaultProgressTimeDisplay,
    resetKey: progressResetKey,
  }));
  const progressDisplay =
    progressSelection.defaultDisplay === defaultProgressTimeDisplay &&
    progressSelection.resetKey === progressResetKey
      ? progressSelection.display
      : defaultProgressTimeDisplay;
  const elapsedLabel = formatDurationBadge(progressSeconds);
  const remainingLabel = `${formatDurationBadge(remainingSeconds)} left`;
  const progressLabel = progressDisplay === "elapsed" ? elapsedLabel : remainingLabel;
  const isElapsedView = progressDisplay === "elapsed";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Episode progress: ${progressLabel}. Toggle progress display`}
      onPress={(event) => {
        event.stopPropagation();
        setProgressSelection({
          defaultDisplay: defaultProgressTimeDisplay,
          display: progressDisplay === "elapsed" ? "remaining" : "elapsed",
          resetKey: progressResetKey,
        });
      }}
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
        size={14}
        tintColor={isElapsedView ? themeColors.bg : themeColors.textMuted}
      />
      <Text
        selectable
        style={{
          fontSize: 14,
          fontWeight: "700",
          color: isElapsedView ? themeColors.bg : themeColors.textMuted,
          fontVariant: ["tabular-nums"],
        }}
        numberOfLines={1}
      >
        {progressLabel}
      </Text>
    </Pressable>
  );
};

export const EpisodeKeyDetails = ({
  podcastTitle,
  publishedLabel,
  durationSeconds,
  progressSeconds,
  remainingSeconds,
  isInProgress = false,
  defaultProgressTimeDisplay = "elapsed",
  progressResetKey,
  onPodcastPress,
}: Props) => {
  const themeColors = useThemeColors();
  const durationLabel = formatDurationBadge(durationSeconds);

  const rows = useMemo(() => {
    const values: {
      key: string;
      icon: SFSymbol;
      value: string;
      onPress?: () => void;
    }[] = [
      {
        key: "podcast",
        icon: "mic.fill",
        value: podcastTitle?.trim() || "Unknown",
        onPress: podcastTitle?.trim() && onPodcastPress ? onPodcastPress : undefined,
      },
      {
        key: "published",
        icon: "calendar",
        value: publishedLabel?.trim() || "Unknown",
      },
    ];

    return values;
  }, [onPodcastPress, podcastTitle, publishedLabel]);

  return (
    <View
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        backgroundColor: themeColors.surface,
        borderWidth: 1,
        borderColor: themeColors.border,
        paddingVertical: 8,
        paddingHorizontal: 10,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 2,
        }}
      >
        {isInProgress ? (
          <EpisodeProgressPill
            progressSeconds={progressSeconds}
            remainingSeconds={remainingSeconds}
            defaultProgressTimeDisplay={defaultProgressTimeDisplay}
            progressResetKey={progressResetKey}
          />
        ) : (
          <View />
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: themeColors.bg,
            }}
          >
            <SymbolView name="clock.fill" size={20} tintColor={themeColors.accent} />
          </View>
          <Text
            selectable
            className="text-sm font-semibold text-text"
            style={{
              fontVariant: ["tabular-nums"],
            }}
          >
            {durationLabel}
          </Text>
        </View>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <View style={{ width: 14, alignItems: "center" }}>
            <SymbolView
              name={row.icon}
              size={12}
              tintColor={row.onPress ? themeColors.accent : themeColors.textMuted}
            />
          </View>
          {row.onPress ? (
            <Pressable
              onPress={row.onPress}
              accessibilityRole="button"
              accessibilityLabel={`Open ${row.value}`}
              style={({ pressed }) => ({
                flex: 1,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <View className="flex-row flex-1 items-center gap-1">
                <Text
                  selectable
                  style={{ fontSize: 14, color: themeColors.accent, fontWeight: "500" }}
                  numberOfLines={1}
                >
                  {row.value}
                </Text>
                <SymbolView name="arrowshape.right.fill" size={12} />
              </View>
            </Pressable>
          ) : (
            <Text
              selectable
              style={{ flex: 1, fontSize: 12, color: themeColors.text }}
              numberOfLines={1}
            >
              {row.value}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
};
