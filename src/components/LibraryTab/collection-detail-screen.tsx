import { collectionsApi } from "@/api/collections-api";
import { useAuthStore } from "@/auth/auth-store";
import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { IndicatorBookListItem } from "@/components/books/indicator-book-list-item";
import {
  arraysMatch,
  ListDetailEditor,
  ListEditButton,
} from "@/components/LibraryTab/list-detail-editor";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { sqliteCollectionsRepository } from "@/data/sqlite/collections-repository";
import { useBookListIndicators } from "@/hooks/use-book-list-indicators";
import { useLibraryCollections } from "@/hooks/use-library-collections";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

type CollectionDetailScreenProps = {
  collectionId: string;
};

const EMPTY_BOOK_IDS: string[] = [];

type CollectionEditSession = {
  collectionId: string;
  name: string;
  bookIds: string[];
};

export const CollectionDetailScreen = ({ collectionId }: CollectionDetailScreenProps) => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const [editSession, setEditSession] = useState<CollectionEditSession | null>(null);
  const [savedOverride, setSavedOverride] = useState<CollectionEditSession | null>(null);
  const [isSavePending, setIsSavePending] = useState(false);
  const {
    collections,
    error,
    isLoading,
    isRefetching,
    refetch,
    snapshotVersion,
  } = useLibraryCollections();
  const collection = collections.find((candidate) => candidate.id === collectionId);
  const bookIdsQueryKey = queryKeys.sqliteCollectionBookIds(
    activeLibraryUserKey,
    activeLibraryId,
    collectionId,
    snapshotVersion,
  );
  const bookIdsQuery = useQuery({
    queryKey: bookIdsQueryKey,
    queryFn: () => sqliteCollectionsRepository.getCollectionBookIds(collectionId),
    enabled: Boolean(activeLibraryId && activeLibraryUserKey && collectionId && collection),
  });
  const bookIds = bookIdsQuery.data ?? EMPTY_BOOK_IDS;
  const bookIdsError = bookIdsQuery.error;
  const activeEditSession =
    collection && editSession?.collectionId === collection.id ? editSession : null;
  const activeSavedOverride =
    collection && savedOverride?.collectionId === collection.id ? savedOverride : null;
  const isEditing = Boolean(activeEditSession);
  const displayedBookIds = activeEditSession?.bookIds ?? activeSavedOverride?.bookIds ?? bookIds;

  const { itemById, onViewableItemsChanged } = useWindowedItemSummaries(displayedBookIds);
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

  const renderEditableBook = useCallback(
    (libraryItemId: string) => {
      const book = itemById.get(libraryItemId);
      return book ? (
        <IndicatorBookListItem
          book={book}
          favoriteIds={favoriteIds}
          finishedIds={finishedIds}
          enableLongPressMenu={false}
          showRowBorders={false}
        />
      ) : null;
    },
    [favoriteIds, finishedIds, itemById],
  );

  const beginEditing = useCallback(() => {
    if (!collection) return;
    setEditSession({
      collectionId: collection.id,
      name: activeSavedOverride?.name ?? collection.name,
      bookIds: [...displayedBookIds],
    });
  }, [activeSavedOverride?.name, collection, displayedBookIds]);

  const saveAndFinishEditing = useCallback(() => {
    if (!collection || !editSession || isSavePending) return;

    const nextName = editSession.name.trim() || collection.name;
    const nextBookIds = editSession.bookIds;
    const originalBookIds = activeSavedOverride?.bookIds ?? bookIds;
    const originalName = activeSavedOverride?.name ?? collection.name;
    const nameChanged = nextName !== originalName;
    const booksChanged = !arraysMatch(originalBookIds, nextBookIds);
    const optimisticOverride = { ...editSession, name: nextName };

    setEditSession(null);
    setSavedOverride(optimisticOverride);
    if (!nameChanged && !booksChanged) {
      setSavedOverride(null);
      return;
    }

    setIsSavePending(true);
    void collectionsApi
      .updateCollection(collection.id, {
        name: nameChanged ? nextName : undefined,
        orderedLibraryItemIds: booksChanged ? nextBookIds : undefined,
      })
      .then(async (updatedCollection) => {
        if (updatedCollection) {
          setSavedOverride({
            collectionId: updatedCollection.id,
            name: updatedCollection.name,
            bookIds: updatedCollection.books.map((book) => book.libraryItemId),
          });
        }

        if (!activeLibraryUserKey || !activeLibraryId) return;
        const refresh = await sqliteCollectionsRepository.refreshCollections({
          userId: activeLibraryUserKey,
          libraryId: activeLibraryId,
        });
        if (refresh.status !== "completed") return;

        const refreshedCollections = await sqliteCollectionsRepository.getCollections();
        const collectionsQueryKey = queryKeys.sqliteCollections(
          activeLibraryUserKey,
          activeLibraryId,
        );
        queryClient.setQueryData(
          collectionsQueryKey,
          { collections: refreshedCollections, refreshError: null },
        );
        const nextSnapshotVersion =
          queryClient.getQueryState(collectionsQueryKey)?.dataUpdatedAt;
        if (nextSnapshotVersion) {
          queryClient.setQueryData(
            queryKeys.sqliteCollectionBookIds(
              activeLibraryUserKey,
              activeLibraryId,
              collection.id,
              nextSnapshotVersion,
            ),
            updatedCollection?.books.map((book) => book.libraryItemId) ?? nextBookIds,
          );
        }
        setSavedOverride(null);
      })
      .catch(() => {
        setSavedOverride(null);
        Alert.alert(
          "Couldn’t save collection changes",
          "Your changes were reverted. Please try again.",
        );
      })
      .finally(() => setIsSavePending(false));
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    activeSavedOverride?.bookIds,
    activeSavedOverride?.name,
    bookIds,
    collection,
    editSession,
    isSavePending,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen
        options={{
          title:
            activeEditSession?.name.trim() ||
            activeSavedOverride?.name ||
            collection?.name ||
            "Collection",
          headerTransparent: true,
          headerShadowVisible: false,
          headerRight: collection
            ? () => (
                <ListEditButton
                  listKind="collection"
                  isEditing={isEditing}
                  isSavePending={isSavePending}
                  onPress={isEditing ? saveAndFinishEditing : beginEditing}
                />
              )
            : undefined,
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
      {collection && activeEditSession ? (
        <ListDetailEditor
          listKind="collection"
          name={activeEditSession.name}
          fallbackName={collection.name}
          bookIds={activeEditSession.bookIds}
          onNameChange={(name) =>
            setEditSession((current) => (current ? { ...current, name } : current))
          }
          onBookIdsChange={(nextBookIds) =>
            setEditSession((current) =>
              current ? { ...current, bookIds: nextBookIds } : current,
            )
          }
          getBookTitle={(libraryItemId) => itemById.get(libraryItemId)?.title}
          renderBook={renderEditableBook}
        />
      ) : null}
      {collection && !isEditing ? (
        <FlashList
          contentInsetAdjustmentBehavior="automatic"
          data={displayedBookIds}
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
