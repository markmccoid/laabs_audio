import { useAuthStore } from "@/auth/auth-store";
import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { IndicatorBookListItem } from "@/components/books/indicator-book-list-item";
import { sqliteSeriesRepository } from "@/data/sqlite/series-repository";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useBookListIndicators } from "@/hooks/use-book-list-indicators";
import { useLibrarySeries } from "@/hooks/use-library-series";
import { queryKeys } from "@/query/query-keys";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeriesDuration } from "@/utils/format-duration";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";

const EMPTY_BOOK_IDS: string[] = [];

export const SeriesDetailScreen = ({ seriesId }: { seriesId: string }) => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { series, error, isLoading, isRefetching, refetch, snapshotVersion } = useLibrarySeries();
  const selectedSeries = series.find((entry) => entry.id === seriesId);
  const totalDurationLabel = formatSeriesDuration(selectedSeries?.totalDuration);
  const bookIdsQuery = useQuery({
    queryKey: queryKeys.sqliteSeriesBookIds(
      activeLibraryUserKey,
      activeLibraryId,
      seriesId,
      snapshotVersion,
    ),
    queryFn: () => sqliteSeriesRepository.getSeriesBookIds(seriesId),
    enabled: Boolean(activeLibraryId && activeLibraryUserKey && seriesId && selectedSeries),
  });
  const bookIds = bookIdsQuery.data ?? EMPTY_BOOK_IDS;
  const { itemById, onViewableItemsChanged } = useWindowedItemSummaries(bookIds);
  const { favoriteIds, finishedIds } = useBookListIndicators();
  const renderBook = useCallback(
    ({ item: libraryItemId }: { item: string }) => {
      const book = itemById.get(libraryItemId);
      if (!book) return <BookListItemPlaceholder />;
      return (
        <IndicatorBookListItem
          book={book}
          favoriteIds={favoriteIds}
          finishedIds={finishedIds}
          href={{
            pathname: "/(tabs)/library/[libraryItemId]",
            params: { libraryItemId: book.id },
          }}
        />
      );
    },
    [favoriteIds, finishedIds, itemById],
  );

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen
        options={{
          title: selectedSeries?.name ?? "Series",
          headerTransparent: true,
          headerShadowVisible: false,
        }}
      />
      {isLoading && !selectedSeries ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <ActivityIndicator size="small" color={themeColors.textMuted} />
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Loading Series...
          </Text>
        </View>
      ) : null}
      {error && !selectedSeries ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Couldn’t load this Series.
          </Text>
        </View>
      ) : null}
      {!isLoading && !error && !selectedSeries ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Series not found.
          </Text>
        </View>
      ) : null}
      {selectedSeries ? (
        <FlashList
          contentInsetAdjustmentBehavior="automatic"
          data={bookIds}
          keyExtractor={(libraryItemId) => libraryItemId}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          renderItem={renderBook}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            totalDurationLabel ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                }}
              >
                <Text
                  selectable
                  style={{
                    color: themeColors.textMuted,
                    fontSize: 16,
                    fontWeight: "semibold",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {totalDurationLabel}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ padding: 24 }}>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
                No books found in this Series.
              </Text>
            </View>
          }
        />
      ) : null}
    </View>
  );
};
