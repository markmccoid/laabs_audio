import { playlistsApi, type PlaylistSummary } from "@/api/playlists-api";
import { useAuthStore } from "@/auth/auth-store";
import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { IndicatorBookListItem } from "@/components/books/indicator-book-list-item";
import {
  arraysMatch,
  ListDetailEditor,
  ListEditButton,
} from "@/components/LibraryTab/list-detail-editor";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useBookListIndicators } from "@/hooks/use-book-list-indicators";
import { useLibraryPlaylists } from "@/hooks/use-library-playlists";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

type PlaylistDetailScreenProps = {
  playlistId: string;
};

type PlaylistEditSession = {
  playlistId: string;
  name: string;
  bookIds: string[];
};

export const PlaylistDetailScreen = ({ playlistId }: PlaylistDetailScreenProps) => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { upsertPlaylistsFromServer } = useDeviceBooksActions();
  const [editSession, setEditSession] = useState<PlaylistEditSession | null>(null);
  const [isSavePending, setIsSavePending] = useState(false);
  const { data: playlists = [], error, isLoading, isRefetching, refetch } = useLibraryPlaylists();
  const playlist = playlists.find((candidate) => candidate.id === playlistId);
  const playlistBookIds = useMemo(
    () => playlist?.items.map((item) => item.libraryItemId).filter(Boolean) ?? [],
    [playlist?.items],
  );
  const activeEditSession =
    playlist && editSession?.playlistId === playlist.id ? editSession : null;
  const isEditing = Boolean(activeEditSession);
  const displayedBookIds = activeEditSession?.bookIds ?? playlistBookIds;
  const { itemById, onViewableItemsChanged } = useWindowedItemSummaries(displayedBookIds);
  const { favoriteIds, finishedIds } = useBookListIndicators();
  const renderPlaylistBook = useCallback(
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

  const beginEditing = useCallback(() => {
    if (!playlist) return;
    setEditSession({
      playlistId: playlist.id,
      name: playlist.name,
      bookIds: [...playlistBookIds],
    });
  }, [playlist, playlistBookIds]);

  const saveAndFinishEditing = useCallback(() => {
    if (!playlist || !editSession || isSavePending) return;

    const playlistQueryKey = queryKeys.libraryPlaylists(
      activeLibraryUserKey,
      activeLibraryId,
    );
    const scopeOptions = {
      userKey: activeLibraryUserKey,
      libraryId: activeLibraryId,
    };
    const nextName = editSession.name.trim() || playlist.name;
    const nextBookIds = editSession.bookIds;
    const nameChanged = nextName !== playlist.name;
    const itemsChanged = !arraysMatch(playlistBookIds, nextBookIds);
    const optimisticPlaylist: PlaylistSummary = {
      ...playlist,
      name: nextName,
      items: nextBookIds.map((libraryItemId) => ({
        mediaKind: "book" as const,
        libraryItemId,
      })),
    };
    const replacePlaylist = (updatedPlaylist: PlaylistSummary) => {
      queryClient.setQueryData<PlaylistSummary[]>(playlistQueryKey, (current = []) =>
        current.map((candidate) =>
          candidate.id === updatedPlaylist.id ? updatedPlaylist : candidate,
        ),
      );
      upsertPlaylistsFromServer([updatedPlaylist], scopeOptions);
    };

    void queryClient.cancelQueries({ queryKey: playlistQueryKey });
    replacePlaylist(optimisticPlaylist);
    setEditSession(null);

    if (!nameChanged && !itemsChanged) return;

    setIsSavePending(true);
    void playlistsApi
      .updatePlaylist(playlist.id, {
        name: nameChanged ? nextName : undefined,
        orderedLibraryItemIds: itemsChanged ? nextBookIds : undefined,
      })
      .then((updatedPlaylist) => {
        if (updatedPlaylist) replacePlaylist(updatedPlaylist);
      })
      .catch(() => {
        replacePlaylist(playlist);
        Alert.alert(
          "Couldn’t save playlist changes",
          "Your changes were reverted. Please try again.",
        );
      })
      .finally(() => setIsSavePending(false));
  }, [
    activeLibraryId,
    activeLibraryUserKey,
    editSession,
    isSavePending,
    playlist,
    playlistBookIds,
    upsertPlaylistsFromServer,
  ]);

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

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen
        options={{
          title: activeEditSession
            ? activeEditSession.name.trim() || playlist?.name || "Playlist"
            : (playlist?.name ?? "Playlist"),
          headerTransparent: true,
          headerShadowVisible: false,
          headerRight: playlist
            ? () => (
                <ListEditButton
                  listKind="playlist"
                  isEditing={isEditing}
                  isSavePending={isSavePending}
                  onPress={isEditing ? saveAndFinishEditing : beginEditing}
                />
              )
            : undefined,
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
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Loading playlist...</Text>
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
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Playlist not found.</Text>
        </View>
      ) : null}
      {playlist && activeEditSession ? (
        <ListDetailEditor
          listKind="playlist"
          name={activeEditSession.name}
          fallbackName={playlist.name}
          bookIds={activeEditSession.bookIds}
          onNameChange={(name) =>
            setEditSession((current) => (current ? { ...current, name } : current))
          }
          onBookIdsChange={(bookIds) =>
            setEditSession((current) => (current ? { ...current, bookIds } : current))
          }
          getBookTitle={(libraryItemId) => itemById.get(libraryItemId)?.title}
          renderBook={renderEditableBook}
        />
      ) : null}
      {playlist && !isEditing ? (
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
