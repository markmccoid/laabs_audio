import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Bookmark } from "@/types/absTypes";
import { formatSeconds } from "@/utils/formatUtils";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";

export const BookBookmarksSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const activeLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const { data: userServerState } = useGetUserServerState();
  const { libraryItemId: libraryItemIdParam } = useLocalSearchParams<{
    libraryItemId?: string | string[];
  }>();
  const libraryItemId = resolveParam(libraryItemIdParam);
  const [pendingBookmarkTime, setPendingBookmarkTime] = useState<number | null>(null);

  const bookmarks = useMemo(() => {
    const bookmarksByLibraryItemId =
      userServerState?.bookmarksByLibraryItemId ??
      (
        userServerState as typeof userServerState & {
          bookmarksByBookId?: Record<string, Bookmark[]>;
        }
      )?.bookmarksByBookId ??
      {};
    return libraryItemId ? (bookmarksByLibraryItemId[libraryItemId] ?? []) : [];
  }, [libraryItemId, userServerState]);

  const handleBookmarkPress = async (bookmark: Bookmark) => {
    if (!libraryItemId) return;
    const targetPositionMs = secondsToMs(bookmark.time);
    const isViewedBookActive = activeLibraryItemId === libraryItemId && queueLength > 0;
    const isViewedBookPlaying = isViewedBookActive && playbackState === "playing";

    setPendingBookmarkTime(bookmark.time);
    try {
      if (isViewedBookPlaying) {
        await playerService.seekTo(targetPositionMs);
      } else if (isViewedBookActive) {
        await playerService.seekTo(targetPositionMs);
      } else {
        await playerService.loadBook(libraryItemId, { autoPlay: false });
        await playerService.seekTo(targetPositionMs);
        await playerService.play();
      }
    } catch (error) {
      console.warn("[BookBookmarksSheet] Failed to jump to bookmark", error);
    } finally {
      setPendingBookmarkTime(null);
      router.back();
    }
  };

  return (
    // <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
    <>
      <View className="flex-row  px-4 pt-4 pb-2 " collapsable={false}>
        <Stack.Screen options={{ headerShown: false, headerTitle: "Bookmarks" }} />
        <Text className="text-xl font-bold">Bookmarks</Text>
      </View>
      <FlatList
        data={libraryItemId ? bookmarks : []}
        keyExtractor={(bookmark) =>
          `${bookmark.libraryItemId}-${bookmark.time}-${bookmark.createdAt}`
        }
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Math.max(24, insets.bottom + 12),
          gap: 10,
        }}
        renderItem={({ item: bookmark }) => {
          const timeLabel = getBookmarkTimeLabel(bookmark.time);
          const title = bookmark.title?.trim() || `Bookmark ${timeLabel}`;
          const isPending = pendingBookmarkTime === bookmark.time;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Go to bookmark at ${timeLabel}`}
              onPress={() => {
                void handleBookmarkPress(bookmark);
              }}
              disabled={isPending}
              style={({ pressed }) => ({
                borderRadius: 14,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                paddingHorizontal: 12,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                opacity: pressed || isPending ? 0.8 : 1,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    borderCurve: "continuous",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: themeColors.bg,
                    borderWidth: 1,
                    borderColor: themeColors.border,
                  }}
                >
                  <SymbolView name="bookmark.fill" tintColor={themeColors.accent} size={13} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    selectable
                    numberOfLines={1}
                    style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                  >
                    {title}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: themeColors.textMuted,
                      fontSize: 12,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {timeLabel}
                  </Text>
                </View>
              </View>
              <SymbolView
                name={isPending ? "hourglass" : "play.fill"}
                tintColor={themeColors.textMuted}
                size={14}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 14,
              paddingVertical: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              No Bookmarks
            </Text>
          </View>
        }
      />
    </>
  );
};
