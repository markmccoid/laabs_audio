import type { LibraryItemSummary } from "@/api/library-items-api";
import { useAuthStore } from "@/auth/auth-store";
import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { IndicatorBookListItem } from "@/components/books/indicator-book-list-item";
import {
  LibraryGridItem,
  LibraryGridItemPlaceholder,
} from "@/components/Library/library-grid-item";
import { refreshPodcastSeriesIndex } from "@/data/sqlite/podcast-series-index-refresh";
import {
  useSearchResultsViewMode,
  useSearchText,
} from "@/search/search-session-store";
import { usePodcastSeriesSearchHits } from "@/podcast/use-podcast-series";
import { queryKeys } from "@/query/query-keys";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme/use-app-theme";

type PodcastSearchContainerProps = {
  padForStatusBar?: boolean;
};

const EMPTY_IDS = new Set<string>();

const hitToSummary = (hit: {
  id: string;
  title: string;
  author: string | null;
  cover: string;
  coverFull: string;
}): LibraryItemSummary => ({
  id: hit.id,
  title: hit.title,
  author: hit.author,
  duration: 0,
  addedAt: 0,
  updatedAt: 0,
  cover: hit.cover,
  coverFull: hit.coverFull,
  numAudioFiles: null,
  ebookFormat: null,
  genres: [],
  tags: [],
});

export const PodcastSearchContainer = ({
  padForStatusBar = false,
}: PodcastSearchContainerProps) => {
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const searchText = useSearchText();
  const viewMode = useSearchResultsViewMode();
  const searchQuery = usePodcastSeriesSearchHits(searchText);
  const hits = searchQuery.data ?? [];
  const summaries = useMemo(() => hits.map(hitToSummary), [hits]);

  const onRefresh = useCallback(async () => {
    if (!activeLibraryId || !activeLibraryUserKey) return;
    setRefreshing(true);
    try {
      await refreshPodcastSeriesIndex({
        userId: activeLibraryUserKey,
        libraryId: activeLibraryId,
        libraryName: activeLibraryName ?? "Podcast Library",
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastSeriesSearchHits(
          activeLibraryUserKey,
          activeLibraryId,
          searchText,
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "titleAsc"),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "addedAtDesc"),
      });
    } finally {
      setRefreshing(false);
    }
  }, [
    activeLibraryId,
    activeLibraryName,
    activeLibraryUserKey,
    queryClient,
    searchText,
  ]);

  const renderItem = useCallback(
    ({ item }: { item: LibraryItemSummary }) => {
      if (viewMode === "grid") {
        return <LibraryGridItem libraryItem={item} />;
      }
      return (
        <IndicatorBookListItem
          book={item}
          favoriteIds={EMPTY_IDS}
          finishedIds={EMPTY_IDS}
          href={`/(tabs)/search/${item.id}`}
        />
      );
    },
    [viewMode],
  );

  if (searchQuery.isLoading && summaries.length === 0) {
    return (
      <View style={{ flex: 1, paddingTop: padForStatusBar ? insets.top : 0 }}>
        {viewMode === "grid" ? <LibraryGridItemPlaceholder /> : <BookListItemPlaceholder />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: padForStatusBar ? insets.top : 0 }}>
      <FlashList
        data={summaries}
        keyExtractor={(item) => item.id}
        numColumns={viewMode === "grid" ? 3 : 1}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text
            style={{
              color: themeColors.textMuted,
              textAlign: "center",
              paddingHorizontal: 24,
              paddingTop: 40,
            }}
          >
            {searchText.trim()
              ? "No podcasts match your search."
              : "No podcasts in the series index yet."}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
};
