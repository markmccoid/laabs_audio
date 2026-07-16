import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { IndicatorBookListItem } from "@/components/books/indicator-book-list-item";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { sqliteCollectionsRepository } from "@/data/sqlite/collections-repository";
import { useLibraryCollections } from "@/hooks/use-library-collections";
import { useBookListIndicators } from "@/hooks/use-book-list-indicators";
import { useAuthStore } from "@/auth/auth-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { queryKeys } from "@/query/query-keys";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { ActivityIndicator, Text, View } from "react-native";

type CollectionDetailScreenProps = {
  collectionId: string;
};

const EMPTY_BOOK_IDS: string[] = [];

export const CollectionDetailScreen = ({ collectionId }: CollectionDetailScreenProps) => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const {
    collections,
    error,
    isLoading,
    isRefetching,
    refetch,
    snapshotVersion,
  } = useLibraryCollections();
  const collection = collections.find((candidate) => candidate.id === collectionId);
  const bookIdsQuery = useQuery({
    queryKey: queryKeys.sqliteCollectionBookIds(
      activeLibraryUserKey,
      activeLibraryId,
      collectionId,
      snapshotVersion,
    ),
    queryFn: () => sqliteCollectionsRepository.getCollectionBookIds(collectionId),
    enabled: Boolean(activeLibraryId && activeLibraryUserKey && collectionId && collection),
  });
  const bookIds = bookIdsQuery.data ?? EMPTY_BOOK_IDS;
  const bookIdsError = bookIdsQuery.error;

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
          title: collection?.name ?? "Collection",
          headerTransparent: true,
          headerShadowVisible: false,
        }}
      />
      {isLoading && !collection ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator size="small" color={themeColors.textMuted} />
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Loading Collection...</Text>
        </View>
      ) : null}
      {error && !collection ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Couldn’t load this Collection.
          </Text>
        </View>
      ) : null}
      {!isLoading && !error && !collection ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Collection not found.</Text>
        </View>
      ) : null}
      {collection ? (
        <FlashList
          contentInsetAdjustmentBehavior="automatic"
          data={bookIds}
          keyExtractor={(libraryItemId, index) => `${libraryItemId}:${index}`}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          renderItem={renderBook}
          ListHeaderComponent={
            collection.description ? (
              <Text style={{ color: themeColors.textMuted, padding: 16 }}>
                {collection.description}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ padding: 24 }}>
              <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
                {bookIdsError ? "Unable to load this Collection’s books." : "No books in this Collection yet."}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 96 }}
          showsVerticalScrollIndicator={false}
        />
      ) : null}
    </View>
  );
};
