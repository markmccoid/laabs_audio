import type { CompositeCoverGridImage } from "@/components/images/composite-cover-grid";
import { StackedSeriesCover } from "@/components/images/stacked-series-cover";
import type { SeriesSummary } from "@/data/sqlite/series-repository";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useLibrarySeries } from "@/hooks/use-library-series";
import type { LibraryViewMode } from "@/library/lists-preferences-store";
import {
  sortSeries,
  type SeriesSortBy,
  type SeriesSortDirection,
} from "@/sort/series-sort";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { memo, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

const MAX_SERIES_COVER_BOOKS = 3;
const SERIES_COVER_SIZE = 105;
const EMPTY_COVER_IMAGES: readonly CompositeCoverGridImage[] = [];
const bookCountLabel = (count: number) => `${count} ${count === 1 ? "book" : "books"}`;

const SeriesRow = memo(function SeriesRow({
  series,
  coverImages,
}: {
  series: SeriesSummary;
  coverImages: readonly CompositeCoverGridImage[];
}) {
  const themeColors = useThemeColors();
  const onPress = useCallback(() => {
    router.push({
      pathname: "/(tabs)/library/series/[seriesId]",
      params: { seriesId: series.id },
    });
  }, [series.id]);
  return (
    <Pressable
      accessibilityLabel={`${series.name}, ${bookCountLabel(series.bookCount)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: themeColors.border,
          opacity: pressed ? 0.72 : 1,
          backgroundColor: themeColors.surface,
          borderWidth: 2,
          borderRightWidth: 0,
          borderLeftWidth: 0,
          marginBottom: 2,
        },
      ]}
    >
      <StackedSeriesCover
        images={coverImages}
        size={SERIES_COVER_SIZE}
        bookCount={series.bookCount}
      />
      <View style={styles.rowDetails}>
        <Text numberOfLines={1} selectable style={[styles.title, { color: themeColors.text }]}>
          {series.name}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={15} tintColor={themeColors.textMuted} />
    </Pressable>
  );
});

const SeriesGridItem = memo(function SeriesGridItem({
  series,
  coverImages,
  coverSize,
}: {
  series: SeriesSummary;
  coverImages: readonly CompositeCoverGridImage[];
  coverSize: number;
}) {
  const themeColors = useThemeColors();
  const onPress = useCallback(() => {
    router.push({
      pathname: "/(tabs)/library/series/[seriesId]",
      params: { seriesId: series.id },
    });
  }, [series.id]);

  return (
    <Pressable
      accessibilityLabel={`${series.name}, ${bookCountLabel(series.bookCount)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.gridItem, { opacity: pressed ? 0.72 : 1 }]}
    >
      <StackedSeriesCover
        images={coverImages}
        size={coverSize}
        bookCount={series.bookCount}
      />
      <Text
        numberOfLines={2}
        selectable
        style={[styles.gridTitle, { color: themeColors.text }]}
      >
        {series.name}
      </Text>
    </Pressable>
  );
});

type SeriesSegmentProps = {
  searchText: string;
  viewMode: LibraryViewMode;
  sortedBy: SeriesSortBy;
  sortDirection: SeriesSortDirection;
};

export const SeriesSegment = ({
  searchText,
  viewMode,
  sortedBy,
  sortDirection,
}: SeriesSegmentProps) => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const { series, bookIdsBySeriesId, error, isLoading, isRefetching, refreshError, refetch } =
    useLibrarySeries();
  const visibleSeries = useMemo(() => {
    const normalizedSearch = searchText.trim().toLocaleLowerCase();
    const filteredSeries = normalizedSearch
      ? series.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedSearch))
      : series;
    return sortSeries(filteredSeries, sortedBy, sortDirection);
  }, [searchText, series, sortDirection, sortedBy]);
  const gridCoverSize = Math.max(72, Math.min(116, Math.floor((width - 48) / 3)));
  const coverBookIds = useMemo(() => {
    const bySeriesId = new Map<string, readonly string[]>();
    const allBookIds: string[] = [];
    const endIndexByRow: number[] = [];
    visibleSeries.forEach((entry) => {
      const bookIds = (bookIdsBySeriesId[entry.id] ?? []).slice(0, MAX_SERIES_COVER_BOOKS);
      bySeriesId.set(entry.id, bookIds);
      allBookIds.push(...bookIds);
      endIndexByRow.push(allBookIds.length - 1);
    });
    return { allBookIds, bySeriesId, endIndexByRow };
  }, [bookIdsBySeriesId, visibleSeries]);
  const { itemById, onViewableItemsChanged: onCoverBooksViewable } = useWindowedItemSummaries(
    coverBookIds.allBookIds,
  );
  const coverImagesBySeriesId = useMemo(() => {
    const next = new Map<string, readonly CompositeCoverGridImage[]>();
    visibleSeries.forEach((entry) => {
      next.set(
        entry.id,
        (coverBookIds.bySeriesId.get(entry.id) ?? [])
          .map((bookId) => itemById.get(bookId))
          .filter((book): book is NonNullable<typeof book> => Boolean(book))
          .map((book) => ({
            key: book.id,
            uri: book.cover,
            libraryItemId: book.id,
            coverUri: book.cover,
            accessibilityLabel: book.title ? `${book.title} cover` : undefined,
          })),
      );
    });
    return next;
  }, [coverBookIds.bySeriesId, itemById, visibleSeries]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) =>
      onCoverBooksViewable({
        viewableItems: viewableItems.map(({ index }) => ({
          index: typeof index === "number" ? (coverBookIds.endIndexByRow[index] ?? null) : null,
        })),
      }),
    [coverBookIds.endIndexByRow, onCoverBooksViewable],
  );
  const renderSeriesRow = useCallback(
    ({ item }: { item: SeriesSummary }) => (
      <SeriesRow
        series={item}
        coverImages={coverImagesBySeriesId.get(item.id) ?? EMPTY_COVER_IMAGES}
      />
    ),
    [coverImagesBySeriesId],
  );
  const renderSeriesGridItem = useCallback(
    ({ item }: { item: SeriesSummary }) => (
      <SeriesGridItem
        series={item}
        coverImages={coverImagesBySeriesId.get(item.id) ?? EMPTY_COVER_IMAGES}
        coverSize={gridCoverSize}
      />
    ),
    [coverImagesBySeriesId, gridCoverSize],
  );

  if (isLoading && series.length === 0) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="small" color={themeColors.textMuted} />
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
          Loading Series...
        </Text>
      </View>
    );
  }
  if (error && series.length === 0) {
    const offline = error instanceof Error && error.message.includes("offline");
    return (
      <View style={styles.centeredState}>
        <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
          {offline ? "Series aren’t available offline yet." : "Couldn’t load Series."}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void refetch()}
          style={{
            borderRadius: 999,
            backgroundColor: themeColors.accent,
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          <Text selectable style={{ color: themeColors.accentForeground, fontWeight: "700" }}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      {refreshError ? (
        <View style={[styles.refreshNotice, { backgroundColor: themeColors.surface }]}>
          <Text selectable style={{ flex: 1, color: themeColors.textMuted, fontSize: 13 }}>
            Showing saved Series. {refreshError}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void refetch()}>
            <Text selectable style={{ color: themeColors.accent, fontWeight: "700" }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}
      <FlashList
        key={viewMode}
        contentInsetAdjustmentBehavior="automatic"
        data={visibleSeries}
        keyExtractor={(entry) => entry.id}
        numColumns={viewMode === "grid" ? 3 : 1}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={viewMode === "grid" ? renderSeriesGridItem : renderSeriesRow}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              {searchText.trim()
                ? `No Series found for “${searchText.trim()}”.`
                : "No Series in this library yet."}
            </Text>
          </View>
        }
        contentContainerStyle={{
          paddingHorizontal: viewMode === "grid" ? 6 : 0,
          paddingTop: viewMode === "grid" ? 8 : 0,
          paddingBottom: 96,
        }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  centeredState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  refreshNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: "100%",
  },
  rowDetails: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "600" },
  gridItem: {
    width: "100%",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 18,
  },
  gridTitle: {
    width: "100%",
    minHeight: 36,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
});
