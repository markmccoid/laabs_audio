import { LIBRARY_BOOK_ACTIONS } from "@/components/books/book-action-types";
import {
  BookListItem,
  BookListItemPlaceholder,
} from "@/components/books/book-list-item";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import {
  useLibrarySearchText,
  useLibrarySessionActions,
} from "@/library/library-session-store";
import { useLibraryResults } from "@/library/use-library-results";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

const SEARCH_HEADER_HEIGHT = 64;
const SEARCH_COMMIT_DELAY_MS = 300;

export const LibrarySegment = () => {
  const queryClient = useQueryClient();
  const searchText = useLibrarySearchText();
  const libraryActions = useLibrarySessionActions();
  const [refreshing, setRefreshing] = useState(false);
  const [searchInput, setSearchInput] = useState(searchText);
  const listRef = useRef<FlashListRef<string>>(null);
  const didPositionSearchHeaderRef = useRef(false);
  const searchCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasCriteriaChangedRef = useRef(false);
  const pendingScrollResetRef = useRef(false);
  const {
    activeLibraryId,
    activeLibraryUserKey,
    itemById,
    resultIds,
    favoriteIds,
    finishedIds,
    onViewableItemsChanged,
    readiness,
    isLoading,
    isPending,
    searchParams,
  } = useLibraryResults();

  useEffect(
    () => () => {
      if (searchCommitTimeoutRef.current) {
        clearTimeout(searchCommitTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (didPositionSearchHeaderRef.current || resultIds.length === 0) return;
    didPositionSearchHeaderRef.current = true;

    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        void listRef.current?.scrollToOffset({
          offset: SEARCH_HEADER_HEIGHT,
          animated: false,
        });
      }, 100);
    });
    return () => cancelAnimationFrame(frame);
  }, [resultIds.length]);

  useEffect(() => {
    if (!hasCriteriaChangedRef.current) {
      hasCriteriaChangedRef.current = true;
      return;
    }
    pendingScrollResetRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!pendingScrollResetRef.current) return;
    pendingScrollResetRef.current = false;

    const frame = requestAnimationFrame(() => {
      setTimeout(() => {
        // Let the new window render before resetting. Resetting the offset while
        // the result IDs change can desynchronize FlashList's render window.
        void listRef.current?.scrollToIndex({ index: 0, animated: false });
      }, 100);
    });
    return () => cancelAnimationFrame(frame);
  }, [resultIds]);

  const onRefresh = useCallback(async () => {
    if (!activeLibraryId || !activeLibraryUserKey) return;

    setRefreshing(true);
    try {
      await sqliteRefreshCoordinator.refreshActiveLibrary(
        { userId: activeLibraryUserKey, libraryId: activeLibraryId },
        { forceCatalog: true, forceOverlay: true, queryClient },
      );
    } finally {
      setRefreshing(false);
    }
  }, [activeLibraryId, activeLibraryUserKey, queryClient]);

  const renderItem = useCallback(
    ({ item: libraryItemId }: { item: string }) => {
      const libraryItem = itemById.get(libraryItemId);
      if (!libraryItem) return <BookListItemPlaceholder />;

      return (
        <BookListItem
          book={libraryItem}
          actionIds={LIBRARY_BOOK_ACTIONS}
          isFavorite={favoriteIds.has(libraryItemId)}
          isFinished={finishedIds.has(libraryItemId)}
          href={{
            pathname: "/(tabs)/library/[libraryItemId]",
            params: { libraryItemId: libraryItem.id },
          }}
        />
      );
    },
    [favoriteIds, finishedIds, itemById],
  );

  const commitSearchText = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchCommitTimeoutRef.current) {
        clearTimeout(searchCommitTimeoutRef.current);
      }
      searchCommitTimeoutRef.current = setTimeout(() => {
        libraryActions.setSearchText(value);
      }, SEARCH_COMMIT_DELAY_MS);
    },
    [libraryActions],
  );

  const clearSearch = useCallback(() => {
    if (searchCommitTimeoutRef.current) {
      clearTimeout(searchCommitTimeoutRef.current);
    }
    setSearchInput("");
    libraryActions.clearSearchText();
  }, [libraryActions]);

  const normalizedSearchText = searchText.trim();
  const isPreparingInitialLibrary = Boolean(
    (isLoading || isPending) &&
    (!readiness || !readiness.hasCatalogRows) &&
    readiness?.lastCatalogRefreshStatus !== "failed",
  );
  const initialCatalogFailed = Boolean(
    readiness &&
    !readiness.hasCatalogRows &&
    readiness.lastCatalogRefreshStatus === "failed",
  );

  if (isPreparingInitialLibrary) {
    return (
      <EmptyState
        title="Preparing your library..."
        description="Building the local catalog for fast browsing and search."
      />
    );
  }

  if (initialCatalogFailed) {
    return (
      <EmptyState
        title="Library could not be prepared."
        description="Reconnect and try again."
        actionLabel="Retry"
        onAction={() => {
          void onRefresh();
        }}
      />
    );
  }

  return (
    <FlashList
      ref={listRef}
      data={resultIds}
      keyExtractor={(libraryItemId) => libraryItemId}
      renderItem={renderItem}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        flexGrow: resultIds.length === 0 ? 1 : undefined,
        paddingBottom: 96,
      }}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onViewableItemsChanged={onViewableItemsChanged}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <LibrarySearchHeader
          value={searchInput}
          onChangeText={commitSearchText}
          onClear={clearSearch}
        />
      }
      ListEmptyComponent={
        normalizedSearchText ? (
          <EmptyState
            title={`No matches for “${normalizedSearchText}”`}
            description="Try a different title, author, or narrator."
            actionLabel="Clear Search"
            onAction={clearSearch}
          />
        ) : (
          <EmptyState
            title="Your library is empty."
            description="Books with playable audio will appear here after your library syncs."
          />
        )
      }
    />
  );
};

type LibrarySearchHeaderProps = {
  value: string;
  onChangeText: (value: string) => void;
  onClear: () => void;
};

const LibrarySearchHeader = ({
  value,
  onChangeText,
  onClear,
}: LibrarySearchHeaderProps) => {
  const themeColors = useThemeColors();

  return (
    <View
      style={{
        height: SEARCH_HEADER_HEIGHT,
        justifyContent: "center",
        paddingHorizontal: 10,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: themeColors.surface,
          borderColor: themeColors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          height: 44,
          paddingHorizontal: 12,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Search title, author, or narrator"
          placeholderTextColor={themeColors.textMuted}
          returnKeyType="search"
          style={{
            color: themeColors.text,
            flex: 1,
            fontSize: 16,
            paddingVertical: 0,
          }}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={onClear}
          >
            <Text
              style={{
                color: themeColors.accent,
                fontSize: 15,
                fontWeight: "600",
              }}
            >
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

const EmptyState = ({
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) => {
  const themeColors = useThemeColors();

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Text
        style={{
          color: themeColors.text,
          fontSize: 16,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: themeColors.textMuted,
          fontSize: 14,
          marginTop: 8,
          textAlign: "center",
        }}
      >
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => ({
            marginTop: 16,
            opacity: pressed ? 0.7 : 1,
            paddingHorizontal: 14,
            paddingVertical: 8,
          })}
        >
          <Text
            style={{
              color: themeColors.accent,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
