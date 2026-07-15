import { LIBRARY_BOOK_ACTIONS } from "@/components/books/book-action-types";
import {
  BookListItem,
  BookListItemPlaceholder,
} from "@/components/books/book-list-item";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useLibraryPlaylists } from "@/hooks/use-library-playlists";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

type PlaylistDetailScreenProps = {
  playlistId: string;
};

export const PlaylistDetailScreen = ({
  playlistId,
}: PlaylistDetailScreenProps) => {
  const themeColors = useThemeColors();
  const {
    data: playlists = [],
    error,
    isLoading,
    isRefetching,
    refetch,
  } = useLibraryPlaylists();
  const playlist = playlists.find((candidate) => candidate.id === playlistId);
  const playlistBookIds = useMemo(
    () =>
      playlist?.items.map((item) => item.libraryItemId).filter(Boolean) ?? [],
    [playlist?.items],
  );
  const { itemById, onViewableItemsChanged } =
    useWindowedItemSummaries(playlistBookIds);
  const renderPlaylistBook = useCallback(
    ({ item: libraryItemId }: { item: string }) => {
      const book = itemById.get(libraryItemId);
      if (!book) return <BookListItemPlaceholder />;

      return (
        <BookListItem
          book={book}
          actionIds={LIBRARY_BOOK_ACTIONS}
          href={{
            pathname: "/(tabs)/library/[libraryItemId]",
            params: { libraryItemId: book.id },
          }}
        />
      );
    },
    [itemById],
  );

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen
        options={{
          title: playlist?.name ?? "Playlist",
          headerTransparent: true,
          headerShadowVisible: false,
        }}
      />
      {isLoading && !playlist ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <ActivityIndicator size="small" color={themeColors.textMuted} />
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Loading playlist...
          </Text>
        </View>
      ) : null}
      {error && !playlist ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Couldn’t load this playlist.
          </Text>
        </View>
      ) : null}
      {!isLoading && !error && !playlist ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Playlist not found.
          </Text>
        </View>
      ) : null}
      {playlist ? (
        <FlashList
          contentInsetAdjustmentBehavior="automatic"
          data={playlistBookIds}
          keyExtractor={(libraryItemId, index) => `${libraryItemId}:${index}`}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          renderItem={renderPlaylistBook}
          ListEmptyComponent={
            <View style={{ padding: 24 }}>
              <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
                No books in this playlist yet.
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
