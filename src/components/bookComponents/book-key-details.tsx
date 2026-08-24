import type { BookProgressTimeDisplay } from "@/store/settings-store";
import { useEbookAccentColor, useThemeColors } from "@/theme/use-app-theme";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  author?: string | null;
  narrator?: string | null;
  publishedYear?: string | null;
  hasEbook?: boolean;
  onEbookPress?: () => void;
  series?: string | null;
  durationSeconds?: number | null;
  progressSeconds?: number | null;
  remainingSeconds?: number | null;
  isInProgress?: boolean;
  defaultProgressTimeDisplay?: BookProgressTimeDisplay;
  progressResetKey?: string;
  onAuthorPress?: (author: string) => void;
  onNarratorPress?: (narrator: string) => void;
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

const BookKeyDetails = ({
  author,
  narrator,
  publishedYear,
  hasEbook = false,
  onEbookPress,
  series,
  durationSeconds,
  progressSeconds,
  remainingSeconds,
  isInProgress = false,
  defaultProgressTimeDisplay = "elapsed",
  progressResetKey,
  onAuthorPress,
  onNarratorPress,
}: Props) => {
  const themeColors = useThemeColors();
  const ebookGreen = useEbookAccentColor();
  const durationLabel = formatDurationBadge(durationSeconds);
  const [progressDisplay, setProgressDisplay] = useState<BookProgressTimeDisplay>(
    defaultProgressTimeDisplay,
  );

  useEffect(() => {
    setProgressDisplay(defaultProgressTimeDisplay);
  }, [defaultProgressTimeDisplay, progressResetKey]);

  const rows = useMemo(() => {
    const values = [
      {
        key: "author",
        icon: "person.fill" as SFSymbol,
        value: author?.trim() || "Unknown",
        onPress: author?.trim() ? onAuthorPress : undefined,
        showEbookBadge: false,
      },
      {
        key: "narrator",
        icon: "person.wave.2.fill" as SFSymbol,
        value: narrator?.trim() || "Unknown",
        onPress: narrator?.trim() ? onNarratorPress : undefined,
        showEbookBadge: false,
      },
      {
        key: "published",
        icon: "calendar" as SFSymbol,
        value: publishedYear?.trim() || "Unknown",
        showEbookBadge: hasEbook,
      },
    ];

    if (series?.trim()) {
      values.push({
        key: "series",
        icon: "books.vertical.fill" as SFSymbol,
        value: series.trim(),
        showEbookBadge: false,
      });
    }

    return values;
  }, [author, hasEbook, narrator, onAuthorPress, onNarratorPress, publishedYear, series]);

  const elapsedLabel = formatDurationBadge(progressSeconds);
  const remainingLabel = `${formatDurationBadge(remainingSeconds)} left`;
  const progressLabel = progressDisplay === "elapsed" ? elapsedLabel : remainingLabel;
  const isElapsedView = progressDisplay === "elapsed";

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
        ) : (
          <View></View>
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
              size={11}
              tintColor={row.onPress ? themeColors.accent : themeColors.textMuted}
            />
          </View>
          {row.onPress ? (
            <Pressable
              onPress={() => row.onPress?.(row.value)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${row.value}`}
              style={({ pressed }) => ({
                flex: 1,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <Text
                selectable
                style={{ flex: 1, fontSize: 12, color: themeColors.accent, fontWeight: "500" }}
                numberOfLines={1}
              >
                {row.value}
              </Text>
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
          {row.showEbookBadge ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ebook available. Open downloads"
              disabled={!onEbookPress}
              onPress={onEbookPress}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: ebookGreen,
                paddingHorizontal: 7,
                paddingVertical: 2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <SymbolView name="book.badge.plus.fill" size={11} tintColor={ebookGreen} />
              <Text style={{ fontSize: 11, fontWeight: "600", color: ebookGreen }}>EBook</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
};

export default BookKeyDetails;
