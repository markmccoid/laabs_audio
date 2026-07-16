import { playlistsApi, type PlaylistSummary } from "@/api/playlists-api";
import { useAuthStore } from "@/auth/auth-store";
import { BookListItemPlaceholder } from "@/components/books/book-list-item";
import { IndicatorBookListItem } from "@/components/books/indicator-book-list-item";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useBookListIndicators } from "@/hooks/use-book-list-indicators";
import { useLibraryPlaylists } from "@/hooks/use-library-playlists";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable, { type SortableFlexDragEndParams } from "react-native-sortables";

type PlaylistDetailScreenProps = {
  playlistId: string;
};

type PlaylistEditSession = {
  playlistId: string;
  name: string;
  bookIds: string[];
};

const arraysMatch = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const PlaylistDetailScreen = ({ playlistId }: PlaylistDetailScreenProps) => {
  const themeColors = useThemeColors();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { upsertPlaylistsFromServer } = useDeviceBooksActions();
  const editScrollRef = useAnimatedRef<ScrollView>();
  const [editSession, setEditSession] = useState<PlaylistEditSession | null>(null);
  const [editListWidth, setEditListWidth] = useState(0);
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
    setEditListWidth(0);
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
      items: nextBookIds.map((libraryItemId) => ({ libraryItemId })),
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

  const handleDragEnd = useCallback(({ order }: SortableFlexDragEndParams) => {
    setEditSession((current) =>
      current ? { ...current, bookIds: order(current.bookIds) } : current,
    );
  }, []);

  const confirmRemoveBook = useCallback(
    (libraryItemId: string) => {
      const bookTitle = itemById.get(libraryItemId)?.title ?? "this book";
      Alert.alert(
        "Remove book from playlist?",
        `Remove \"${bookTitle}\" from \"${editSession?.name.trim() || playlist?.name || "this playlist"}\"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              setEditSession((current) =>
                current
                  ? {
                      ...current,
                      bookIds: current.bookIds.filter((bookId) => bookId !== libraryItemId),
                    }
                  : current,
              );
            },
          },
        ],
        { cancelable: true },
      );
    },
    [editSession?.name, itemById, playlist?.name],
  );

  const renderEditableBook = useCallback(
    (libraryItemId: string) => {
      const book = itemById.get(libraryItemId);

      return (
        <View
          style={{
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${book?.title ?? "book"} from playlist`}
            onPress={() => confirmRemoveBook(libraryItemId)}
            hitSlop={6}
            style={{ width: 32, alignItems: "center", justifyContent: "center" }}
          >
            <SymbolView name="minus.circle.fill" tintColor="#d32424" size={24} />
          </Pressable>

          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              overflow: "hidden",
            }}
          >
            <View style={{ flex: 1 }} pointerEvents="none">
              {book ? (
                <IndicatorBookListItem
                  book={book}
                  favoriteIds={favoriteIds}
                  finishedIds={finishedIds}
                  enableLongPressMenu={false}
                  showRowBorders={false}
                />
              ) : (
                <BookListItemPlaceholder showRowBorders={false} />
              )}
            </View>

            <Sortable.Handle
              style={{
                minWidth: 40,
                alignSelf: "stretch",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SymbolView name="line.3.horizontal" tintColor={themeColors.textMuted} size={22} />
            </Sortable.Handle>
          </View>
        </View>
      );
    },
    [confirmRemoveBook, favoriteIds, finishedIds, itemById, themeColors],
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isEditing ? "Save playlist changes" : "Edit playlist"}
                  disabled={isSavePending}
                  onPress={isEditing ? saveAndFinishEditing : beginEditing}
                  hitSlop={10}
                  style={{
                    paddingHorizontal: 4,
                    paddingVertical: 4,
                    opacity: isSavePending ? 0.55 : 1,
                  }}
                >
                  <SymbolView
                    name={isEditing ? "checkmark" : "pencil"}
                    tintColor={themeColors.accent}
                    size={19}
                  />
                </Pressable>
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
        <Animated.ScrollView
          ref={editScrollRef}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 96, gap: 14 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: 7 }}>
            <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
              Playlist name
            </Text>
            <TextInput
              value={activeEditSession.name}
              onChangeText={(name) =>
                setEditSession((current) => (current ? { ...current, name } : current))
              }
              placeholder="Playlist name"
              placeholderTextColor={themeColors.textMuted}
              returnKeyType="done"
              selectTextOnFocus
              style={{
                minHeight: 46,
                borderRadius: 12,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
                color: themeColors.text,
                fontSize: 16,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
              Drag books by the handle or remove them with the minus button. Changes are saved when
              you tap the checkmark.
            </Text>
          </View>

          {activeEditSession.bookIds.length > 0 ? (
            <View
              style={{ width: "100%" }}
              onLayout={(event) => {
                const nextWidth = Math.round(event.nativeEvent.layout.width);
                if (nextWidth <= 0) return;
                setEditListWidth((current) => (current === nextWidth ? current : nextWidth));
              }}
            >
              {editListWidth > 0 ? (
                <Sortable.Flex
                  width="fill"
                  flexDirection="column"
                  flexWrap="nowrap"
                  rowGap={8}
                  customHandle
                  scrollableRef={editScrollRef}
                  onDragEnd={handleDragEnd}
                  sortEnabled
                >
                  {activeEditSession.bookIds.map((libraryItemId) => (
                    <View key={libraryItemId} style={{ width: editListWidth }}>
                      {renderEditableBook(libraryItemId)}
                    </View>
                  ))}
                </Sortable.Flex>
              ) : null}
            </View>
          ) : (
            <View style={{ paddingVertical: 24 }}>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
                No books in this playlist.
              </Text>
            </View>
          )}
        </Animated.ScrollView>
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
