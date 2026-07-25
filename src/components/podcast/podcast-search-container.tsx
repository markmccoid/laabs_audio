import { useAuthStore } from "@/auth/auth-store";
import { PodcastShowsBrowser } from "@/components/podcast/podcast-shows-browser";
import { refreshPodcastSeriesIndex } from "@/data/sqlite/podcast-series-index-refresh";
import {
  useSearchResultsViewMode,
  useSearchText,
} from "@/search/search-session-store";
import { usePodcastSeriesSearchHits } from "@/podcast/use-podcast-series";
import { queryKeys } from "@/query/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import type { Href } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type PodcastSearchContainerProps = {
  padForStatusBar?: boolean;
};

const podcastSearchDetailHref = (libraryItemId: string): Href =>
  `/(tabs)/search/${libraryItemId}`;

export const PodcastSearchContainer = ({
  padForStatusBar = false,
}: PodcastSearchContainerProps) => {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const searchText = useSearchText();
  const viewMode = useSearchResultsViewMode();
  const searchQuery = usePodcastSeriesSearchHits(searchText);
  const hits = searchQuery.data ?? [];

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

  return (
    <View style={{ flex: 1, paddingTop: padForStatusBar ? insets.top : 0 }}>
      <PodcastShowsBrowser
        shows={hits}
        isLoading={searchQuery.isLoading}
        viewMode={viewMode}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        detailHref={podcastSearchDetailHref}
        emptyMessage={
          searchText.trim()
            ? "No podcasts match your search."
            : "No podcasts in the series index yet."
        }
      />
    </View>
  );
};
