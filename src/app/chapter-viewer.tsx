import { useGetItemDetails, useGetUserServerState } from "@/hooks/abs-data-hooks";
import { playbackStore, playerService, usePlaybackStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { FlashList } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

type ChapterListItem = {
  id: number;
  title: string;
  startMs: number;
  endMs: number;
};

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const findChapterForPosition = <T extends { startMs: number; endMs: number }>(
  chapterWindows: T[],
  positionMs: number,
) => {
  if (!chapterWindows.length) return null;
  const found = chapterWindows.find(
    (chapter) => positionMs >= chapter.startMs && positionMs < chapter.endMs,
  );
  if (found) return found;
  if (positionMs < chapterWindows[0].startMs) return chapterWindows[0];
  return chapterWindows[chapterWindows.length - 1];
};

const ChapterViewerRoute = () => {
  const themeColors = useThemeColors();
  const params = useLocalSearchParams<{ libraryItemId?: string | string[] }>();
  const routeLibraryItemId = Array.isArray(params.libraryItemId)
    ? params.libraryItemId[0]
    : params.libraryItemId;
  const [pendingChapterId, setPendingChapterId] = useState<number | null>(null);
  const hasAutoScrolled = useRef(false);
  const listRef = useRef<FlashList<ChapterListItem>>(null);

  const { data: bookData, isLoading, isError, refetch } = useGetItemDetails(routeLibraryItemId);
  const { data: userServerState } = useGetUserServerState();
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const chapterIndex = usePlaybackStore((state) => state.chapterIndex);

  const chapterItems = useMemo<ChapterListItem[]>(
    () =>
      [...(bookData?.media?.chapters ?? [])]
        .sort((a, b) => a.start - b.start)
        .map((chapter, index, source) => {
          const startMs = secondsToMs(chapter.start);
          const nextChapter = source[index + 1];
          const endMs = nextChapter ? secondsToMs(nextChapter.start) : secondsToMs(chapter.end);
          return {
            id: chapter.id,
            title: chapter.title || `Chapter ${index + 1}`,
            startMs,
            endMs: Math.max(startMs, endMs),
          };
        }),
    [bookData?.media?.chapters],
  );

  const localProgressMs = useMemo(() => {
    if (!routeLibraryItemId) return 0;
    const progressByLibraryItemId =
      userServerState?.progressByLibraryItemId ??
      (
        userServerState as typeof userServerState & {
          progressByBookId?: Record<string, { currentTime: number }>;
        }
      )?.progressByBookId ??
      {};
    const currentTimeSeconds = progressByLibraryItemId[routeLibraryItemId]?.currentTime ?? 0;
    return secondsToMs(currentTimeSeconds);
  }, [routeLibraryItemId, userServerState]);

  const isViewedBookActive =
    Boolean(routeLibraryItemId) && currentLibraryItemId === routeLibraryItemId;
  const isViewedBookLoaded = isViewedBookActive && queueLength > 0;
  const fallbackDurationMs = Math.max(
    0,
    Math.round((bookData?.media?.duration ?? bookData?.duration ?? 0) * 1000),
  );
  const sourceBookPositionMs = isViewedBookLoaded ? positionMs : localProgressMs;
  const resolvedBookPositionMs =
    fallbackDurationMs > 0
      ? clamp(sourceBookPositionMs, 0, fallbackDurationMs)
      : Math.max(sourceBookPositionMs, 0);

  const activeChapterId = useMemo(() => {
    if (isViewedBookLoaded && chapterIndex.length) {
      return findChapterForPosition(chapterIndex, resolvedBookPositionMs)?.id ?? null;
    }
    return findChapterForPosition(chapterItems, resolvedBookPositionMs)?.id ?? null;
  }, [isViewedBookLoaded, chapterIndex, resolvedBookPositionMs, chapterItems]);
  const activeChapterIndex = useMemo(
    () => chapterItems.findIndex((chapter) => chapter.id === activeChapterId),
    [activeChapterId, chapterItems],
  );

  useEffect(() => {
    hasAutoScrolled.current = false;
  }, [routeLibraryItemId]);

  useEffect(() => {
    if (hasAutoScrolled.current) return;
    if (activeChapterIndex < 0) return;
    if (activeChapterIndex >= chapterItems.length) return;

    const timeoutId = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: activeChapterIndex,
        animated: false,
        viewPosition: 0.5,
      });
      hasAutoScrolled.current = true;
    }, 140);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [activeChapterIndex, chapterItems.length]);

  const handlePressChapter = useCallback(
    async (chapter: ChapterListItem) => {
      if (!routeLibraryItemId || pendingChapterId !== null) return;

      const shouldAutoPlay = playbackState === "playing";
      const viewedBookLoadedNow = currentLibraryItemId === routeLibraryItemId && queueLength > 0;
      setPendingChapterId(chapter.id);

      try {
        if (!viewedBookLoadedNow) {
          await playerService.loadBook(routeLibraryItemId, { autoPlay: shouldAutoPlay });
        }
        await playerService.seekTo(chapter.startMs);
        const latestPlaybackState = playbackStore.getState().playbackState;
        if (!shouldAutoPlay && !viewedBookLoadedNow && latestPlaybackState === "playing") {
          await playerService.pause();
        }
      } finally {
        setPendingChapterId(null);
      }
    },
    [routeLibraryItemId, pendingChapterId, playbackState, currentLibraryItemId, queueLength],
  );

  if (!routeLibraryItemId) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 14, color: themeColors.textMuted, textAlign: "center" }}>
          No book selected.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <Text style={{ fontSize: 24, fontWeight: "700", color: themeColors.text }}>Chapters</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chapter list"
            onPress={() => router.back()}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderCurve: "continuous",
              backgroundColor: themeColors.bg,
              paddingVertical: 6,
              paddingHorizontal: 12,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: themeColors.textMuted }}>Close</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={{ marginTop: 4, fontSize: 13, color: themeColors.textMuted }}>
          {bookData?.title ?? "Loading..."}
        </Text>
      </View>

      {isLoading && !chapterItems.length ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ActivityIndicator color={themeColors.accent} />
          <Text style={{ fontSize: 13, color: themeColors.textMuted }}>Loading chapters...</Text>
        </View>
      ) : null}

      {isError && !chapterItems.length ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}
        >
          <Text style={{ fontSize: 14, color: "#991b1b", textAlign: "center" }}>
            Could not load chapters.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => refetch()}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderCurve: "continuous",
              backgroundColor: themeColors.accent,
              paddingVertical: 8,
              paddingHorizontal: 14,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "600" }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {!isLoading && !isError && !chapterItems.length ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 14, color: themeColors.textMuted, textAlign: "center" }}>
            No chapter data is available for this book.
          </Text>
        </View>
      ) : null}

      {chapterItems.length ? (
        <FlashList
          ref={listRef}
          data={chapterItems}
          keyExtractor={(item) => String(item.id)}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item, index }) => {
            const isActive = item.id === activeChapterId;
            const isPending = pendingChapterId === item.id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Chapter ${index + 1}: ${item.title}`}
                onPress={() => void handlePressChapter(item)}
                disabled={pendingChapterId !== null}
                style={({ pressed }) => ({
                  borderRadius: 14,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: isActive ? themeColors.accent : themeColors.border,
                  backgroundColor: isActive ? themeColors.accent : themeColors.surface,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  opacity: pendingChapterId !== null ? 0.7 : pressed ? 0.8 : 1,
                })}
              >
                <View className="flex-row justify-between items-center">
                  <View className="w-[35] h-full items-start justify-center ">
                    <Text
                      style={{
                        fontSize: 15,
                        letterSpacing: 0.4,
                        fontWeight: "600",
                        color: isActive ? "#ffffff" : themeColors.textMuted,
                        textTransform: "uppercase",
                      }}
                    >
                      {index + 1}
                    </Text>
                  </View>
                  <View className="flex-row justify-start items-center flex-1 h-full">
                    <Text
                      numberOfLines={2}
                      ellipsizeMode="tail"
                      style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: isActive ? "#ffffff" : themeColors.text,
                      }}
                    >
                      {item.title}
                    </Text>
                  </View>
                  <View className="flex-col">
                    <Text style={{ color: isActive ? "#ffffff" : themeColors.textMuted }}>
                      {formatSeconds(item.startMs / 1000)}
                    </Text>
                    <Text style={{ color: isActive ? "#ffffff" : themeColors.textMuted }}>
                      {formatSeconds(item.endMs / 1000)}
                    </Text>
                  </View>
                </View>
                {isPending ? (
                  <Text
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: isActive ? "#ffffff" : themeColors.textMuted,
                    }}
                  >
                    Jumping...
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : null}
    </View>
  );
};

export default ChapterViewerRoute;
