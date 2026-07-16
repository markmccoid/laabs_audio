import type { PlaylistSummary } from "@/api/playlists-api";
import {
  CompositeCoverGrid,
  type CompositeCoverGridImage,
} from "@/components/images/composite-cover-grid";
import { useWindowedItemSummaries } from "@/data/sqlite/use-windowed-item-summaries";
import { useLibraryPlaylists } from "@/hooks/use-library-playlists";
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

const playlistCountLabel = (count: number) => `${count} ${count === 1 ? "book" : "books"}`;
const MAX_PLAYLIST_COVER_BOOKS = 4;
const PLAYLIST_COVER_SIZE = 78;
const EMPTY_COVER_IMAGES: readonly CompositeCoverGridImage[] = [];

type PlaylistRowProps = {
  playlist: PlaylistSummary;
  coverImages: readonly CompositeCoverGridImage[];
};

const PlaylistRow = memo(function PlaylistRow({ playlist, coverImages }: PlaylistRowProps) {
  const themeColors = useThemeColors();
  const href = useMemo(
    () => ({
      pathname: "/(tabs)/library/playlist/[playlistId]" as const,
      params: { playlistId: playlist.id },
    }),
    [playlist.id],
  );
  const handlePress = useCallback(() => {
    router.push(href);
  }, [href]);

  return (
    <Pressable
      accessibilityLabel={`${playlist.name}, ${playlistCountLabel(playlist.items.length)}`}
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
        fallbackSystemName="music.note.list"
        size={PLAYLIST_COVER_SIZE}
      />
      <View style={styles.rowDetails}>
        <Text numberOfLines={1} style={[styles.title, { color: themeColors.text }]}>
          {playlist.name}
        </Text>
        <Text style={[styles.count, { color: themeColors.textMuted }]}>
          {playlistCountLabel(playlist.items.length)}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={15} tintColor={themeColors.textMuted} />
    </Pressable>
  );
});

const PlaylistGridItem = memo(function PlaylistGridItem({
  playlist,
  coverImages,
  coverSize,
}: PlaylistRowProps & { coverSize: number }) {
  const handlePress = useCallback(() => {
    router.push({
      pathname: "/(tabs)/library/playlist/[playlistId]",
      params: { playlistId: playlist.id },
    });
  }, [playlist.id]);

  return (
    <LibraryGroupGridItem
      title={playlist.name}
      countLabel={playlistCountLabel(playlist.items.length)}
      coverImages={coverImages}
      coverSize={coverSize}
      fallbackSystemName="music.note.list"
      onPress={handlePress}
    />
  );
});

export const PlaylistsSegment = ({ viewMode }: { viewMode: LibraryViewMode }) => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const { data: playlists = [], error, isLoading, isRefetching, refetch } = useLibraryPlaylists();
  const gridCoverSize = Math.max(72, Math.min(116, Math.floor((width - 48) / 3)));
  const playlistCoverBookIds = useMemo(() => {
    const bookIdsByPlaylistId = new Map<string, readonly string[]>();
    const allBookIds: string[] = [];
    const endIndexByPlaylistRow: number[] = [];

    playlists.forEach((playlist) => {
      const bookIds = playlist.items
        .slice(0, MAX_PLAYLIST_COVER_BOOKS)
        .map((item) => item.libraryItemId)
        .filter(Boolean);
      bookIdsByPlaylistId.set(playlist.id, bookIds);
      allBookIds.push(...bookIds);
      endIndexByPlaylistRow.push(allBookIds.length - 1);
    });

    return { allBookIds, bookIdsByPlaylistId, endIndexByPlaylistRow };
  }, [playlists]);
  const { itemById: coverBooksById, onViewableItemsChanged: onCoverBookIdsViewable } =
    useWindowedItemSummaries(playlistCoverBookIds.allBookIds);
  const coverImagesByPlaylistId = useMemo(() => {
    const next = new Map<string, readonly CompositeCoverGridImage[]>();

    playlists.forEach((playlist) => {
      const coverImages = (playlistCoverBookIds.bookIdsByPlaylistId.get(playlist.id) ?? [])
        .map((bookId) => coverBooksById.get(bookId))
        .filter((book): book is NonNullable<typeof book> => Boolean(book))
        .map((book) => ({
          key: book.id,
          uri: book.cover,
          libraryItemId: book.id,
          coverUri: book.cover,
          accessibilityLabel: book.title ? `${book.title} cover` : undefined,
        }));
      next.set(playlist.id, coverImages);
    });

    return next;
  }, [coverBooksById, playlistCoverBookIds.bookIdsByPlaylistId, playlists]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      // Translate playlist-row visibility into the corresponding cover window.
      onCoverBookIdsViewable({
        viewableItems: viewableItems.map(({ index }) => ({
          index:
            typeof index === "number"
              ? (playlistCoverBookIds.endIndexByPlaylistRow[index] ?? null)
              : null,
        })),
      });
    },
    [onCoverBookIdsViewable, playlistCoverBookIds.endIndexByPlaylistRow],
  );
  const renderPlaylistRow = useCallback(
    ({ item }: { item: PlaylistSummary }) => (
      <PlaylistRow
        playlist={item}
        coverImages={coverImagesByPlaylistId.get(item.id) ?? EMPTY_COVER_IMAGES}
      />
    ),
    [coverImagesByPlaylistId],
  );
  const renderPlaylistGridItem = useCallback(
    ({ item }: { item: PlaylistSummary }) => (
      <PlaylistGridItem
        playlist={item}
        coverImages={coverImagesByPlaylistId.get(item.id) ?? EMPTY_COVER_IMAGES}
        coverSize={gridCoverSize}
      />
    ),
    [coverImagesByPlaylistId, gridCoverSize],
  );

  if (isLoading && playlists.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <ActivityIndicator size="small" color={themeColors.textMuted} />
        <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Loading playlists...</Text>
      </View>
    );
  }

  if (error && playlists.length === 0) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}
      >
        <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
          Couldn’t load playlists.
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
    <FlashList
      key={viewMode}
      contentInsetAdjustmentBehavior="automatic"
      data={playlists}
      keyExtractor={(playlist) => playlist.id}
      numColumns={viewMode === "grid" ? 3 : 1}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      onViewableItemsChanged={onViewableItemsChanged}
      renderItem={viewMode === "grid" ? renderPlaylistGridItem : renderPlaylistRow}
      ListEmptyComponent={
        <View style={{ padding: 24 }}>
          <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>
            No playlists in this library yet.
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
  );
};

const styles = StyleSheet.create({
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
