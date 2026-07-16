import {
  CompositeCoverGrid,
  type CompositeCoverGridImage,
} from "@/components/images/composite-cover-grid";
import type { CollectionSummary } from "@/data/sqlite/collections-repository";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useLibraryCollections } from "@/hooks/use-library-collections";
import type { LibraryViewMode } from "@/library/lists-preferences-store";
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
import { LibraryGroupGridItem } from "./library-group-grid-item";

const MAX_COLLECTION_COVER_BOOKS = 4;
const COLLECTION_COVER_SIZE = 78;
const EMPTY_COVER_IMAGES: readonly CompositeCoverGridImage[] = [];

const collectionCountLabel = (count: number) => `${count} ${count === 1 ? "book" : "books"}`;

type CollectionRowProps = {
  collection: CollectionSummary;
  coverImages: readonly CompositeCoverGridImage[];
};

const CollectionRow = memo(function CollectionRow({ collection, coverImages }: CollectionRowProps) {
  const themeColors = useThemeColors();
  const href = useMemo(
    () => ({
      pathname: "/(tabs)/library/collection/[collectionId]" as const,
      params: { collectionId: collection.id },
    }),
    [collection.id],
  );
  const handlePress = useCallback(() => {
    router.push(href);
  }, [href]);

  return (
    <Pressable
      accessibilityLabel={`${collection.name}, ${collectionCountLabel(collection.bookCount)}`}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: themeColors.border,
          opacity: pressed ? 0.72 : 1,
          backgroundColor: themeColors.surface,
          borderWidth: 2,
          borderRightWidth: 0,
          borderLeftWidth: 0,
          marginBottom: 3,
        },
      ]}
    >
      <CompositeCoverGrid
        images={coverImages}
        fallbackSystemName="books.vertical"
        size={COLLECTION_COVER_SIZE}
      />
      <View style={styles.rowDetails}>
        <Text numberOfLines={1} style={[styles.title, { color: themeColors.text }]}>
          {collection.name}
        </Text>
        <Text style={[styles.count, { color: themeColors.textMuted }]}>
          {collectionCountLabel(collection.bookCount)}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={15} tintColor={themeColors.textMuted} />
    </Pressable>
  );
});

const CollectionGridItem = memo(function CollectionGridItem({
  collection,
  coverImages,
  coverSize,
}: CollectionRowProps & { coverSize: number }) {
  const handlePress = useCallback(() => {
    router.push({
      pathname: "/(tabs)/library/collection/[collectionId]",
      params: { collectionId: collection.id },
    });
  }, [collection.id]);

  return (
    <LibraryGroupGridItem
      title={collection.name}
      countLabel={collectionCountLabel(collection.bookCount)}
      coverImages={coverImages}
      coverSize={coverSize}
      fallbackSystemName="books.vertical"
      onPress={handlePress}
    />
  );
});

export const CollectionsSegment = ({ viewMode }: { viewMode: LibraryViewMode }) => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const {
    collections,
    bookIdsByCollectionId,
    error,
    isLoading,
    isRefetching,
    refreshError,
    refetch,
  } = useLibraryCollections();
  const gridCoverSize = Math.max(72, Math.min(116, Math.floor((width - 48) / 3)));
  const coverBookIds = useMemo(() => {
    const coverBookIdsByCollectionId = new Map<string, readonly string[]>();
    const allBookIds: string[] = [];
    const endIndexByRow: number[] = [];

    collections.forEach((collection) => {
      const bookIds = (bookIdsByCollectionId[collection.id] ?? []).slice(
        0,
        MAX_COLLECTION_COVER_BOOKS,
      );
      coverBookIdsByCollectionId.set(collection.id, bookIds);
      allBookIds.push(...bookIds);
      endIndexByRow.push(allBookIds.length - 1);
    });

    return { allBookIds, bookIdsByCollectionId: coverBookIdsByCollectionId, endIndexByRow };
  }, [bookIdsByCollectionId, collections]);
  const { itemById: coverBooksById, onViewableItemsChanged: onCoverBookIdsViewable } =
    useWindowedItemSummaries(coverBookIds.allBookIds);
  const coverImagesByCollectionId = useMemo(() => {
    const next = new Map<string, readonly CompositeCoverGridImage[]>();

    collections.forEach((collection) => {
      const coverImages = (coverBookIds.bookIdsByCollectionId.get(collection.id) ?? [])
        .map((bookId) => coverBooksById.get(bookId))
        .filter((book): book is NonNullable<typeof book> => Boolean(book))
        .map((book) => ({
          key: book.id,
          uri: book.cover,
          libraryItemId: book.id,
          coverUri: book.cover,
          accessibilityLabel: book.title ? `${book.title} cover` : undefined,
        }));
      next.set(collection.id, coverImages);
    });

    return next;
  }, [collections, coverBookIds.bookIdsByCollectionId, coverBooksById]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      onCoverBookIdsViewable({
        viewableItems: viewableItems.map(({ index }) => ({
          index: typeof index === "number" ? (coverBookIds.endIndexByRow[index] ?? null) : null,
        })),
      });
    },
    [coverBookIds.endIndexByRow, onCoverBookIdsViewable],
  );
  const renderCollectionRow = useCallback(
    ({ item }: { item: CollectionSummary }) => (
      <CollectionRow
        collection={item}
        coverImages={coverImagesByCollectionId.get(item.id) ?? EMPTY_COVER_IMAGES}
      />
    ),
    [coverImagesByCollectionId],
  );
  const renderCollectionGridItem = useCallback(
    ({ item }: { item: CollectionSummary }) => (
      <CollectionGridItem
        collection={item}
        coverImages={coverImagesByCollectionId.get(item.id) ?? EMPTY_COVER_IMAGES}
        coverSize={gridCoverSize}
      />
    ),
    [coverImagesByCollectionId, gridCoverSize],
  );

  if (isLoading && collections.length === 0) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="small" color={themeColors.textMuted} />
        <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Loading Collections...</Text>
      </View>
    );
  }

  if (error && collections.length === 0) {
    const offline = error instanceof Error && error.message.includes("offline");
    return (
      <View style={styles.centeredState}>
        <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
          {offline ? "Collections aren’t available offline yet." : "Couldn’t load Collections."}
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
          <Text style={{ color: themeColors.accentForeground, fontWeight: "700" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {refreshError ? (
        <View style={[styles.refreshNotice, { backgroundColor: themeColors.surface }]}>
          <Text style={{ flex: 1, color: themeColors.textMuted, fontSize: 13 }}>
            Showing saved Collections. {refreshError}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void refetch()}>
            <Text style={{ color: themeColors.accent, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <FlashList
        key={viewMode}
        contentInsetAdjustmentBehavior="automatic"
        data={collections}
        keyExtractor={(collection) => collection.id}
        numColumns={viewMode === "grid" ? 3 : 1}
        refreshing={isRefetching}
        onRefresh={() => void refetch()}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={viewMode === "grid" ? renderCollectionGridItem : renderCollectionRow}
        ListEmptyComponent={
          <View style={{ padding: 24 }}>
            <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
              No Collections in this library yet.
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
  centeredState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
  },
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
    minHeight: 98,
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: "100%",
  },
  rowDetails: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  count: {
    fontSize: 14,
  },
});
