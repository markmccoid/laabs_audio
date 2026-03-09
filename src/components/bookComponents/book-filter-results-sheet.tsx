import type { LibraryItemsSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { BookFlashListRow } from "@/components/books/book-flashlist-row";
import { useGetUserServerState } from "@/hooks/abs-data-hooks";
import { queryKeys } from "@/query/query-keys";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

type SourceTab = "home" | "search";
type FilterType = "genre" | "tag" | "author" | "narrator";

const isFilterType = (value: string | undefined): value is FilterType =>
  value === "genre" || value === "tag" || value === "author" || value === "narrator";

const getFilterLabel = (filterType: FilterType) => {
  switch (filterType) {
    case "genre":
      return "Genre";
    case "tag":
      return "Tag";
    case "author":
      return "Author";
    case "narrator":
      return "Narrator";
    default:
      return "Filter";
  }
};

export const BookFilterResultsSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState("");
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const isOffline = useAuthStore((state) => state.isOnline === false);
  const { data: userServerState } = useGetUserServerState();
  const queryClient = useQueryClient();
  const {
    filterType: filterTypeParam,
    filterValue: filterValueParam,
    sourceTab: sourceTabParam,
  } = useLocalSearchParams<{
    filterType?: string | string[];
    filterValue?: string | string[];
    sourceTab?: string | string[];
  }>();
  const rawFilterType = resolveParam(filterTypeParam);
  const filterType = isFilterType(rawFilterType) ? rawFilterType : undefined;
  const filterValue = resolveParam(filterValueParam);
  const sourceTabParamResolved = resolveParam(sourceTabParam);
  const sourceTab: SourceTab = sourceTabParamResolved === "search" ? "search" : "home";
  const deferredSearchText = useDeferredValue(searchText);
  const booksQueryKey = queryKeys.libraryBooks(activeLibraryId);
  const immediateCatalog = activeLibraryId
    ? queryClient.getQueryData<LibraryItemsSummary>(booksQueryKey)
    : undefined;

  const { data: subscribedCatalog } = useQuery<LibraryItemsSummary>({
    queryKey: booksQueryKey,
    queryFn: async () => immediateCatalog ?? [],
    enabled: false,
    initialData: immediateCatalog,
    meta: { persist: true },
  });

  const catalog = useMemo(
    () => subscribedCatalog ?? immediateCatalog ?? [],
    [immediateCatalog, subscribedCatalog],
  );
  const progressByLibraryItemId =
    userServerState?.progressByLibraryItemId ??
    (
      userServerState as typeof userServerState & {
        progressByBookId?: Record<string, UserBookProgress>;
      }
    )?.progressByBookId ??
    {};

  const matchingBooks = useMemo(() => {
    if (!filterType || !filterValue) return [];

    return catalog.filter((book) => {
      if (filterType === "genre") {
        return book.genres.includes(filterValue);
      }

      if (filterType === "tag") {
        return book.tags.includes(filterValue);
      }

      if (filterType === "author") {
        return (book.author ?? "") === filterValue;
      }

      return (book.narratedBy ?? "") === filterValue;
    });
  }, [catalog, filterType, filterValue]);
  const normalizedSearchQuery = useMemo(
    () => deferredSearchText.trim().toLocaleLowerCase(),
    [deferredSearchText],
  );
  const filteredMatchingBooks = useMemo(() => {
    if (!normalizedSearchQuery) {
      return matchingBooks;
    }

    return matchingBooks.filter((book) => {
      const normalizedTitle = book.title.toLocaleLowerCase();
      const normalizedAuthor = (book.author ?? "").toLocaleLowerCase();

      return (
        normalizedTitle.includes(normalizedSearchQuery) ||
        normalizedAuthor.includes(normalizedSearchQuery)
      );
    });
  }, [matchingBooks, normalizedSearchQuery]);

  const handleBookPress = (libraryItemId: string) => {
    const destination =
      sourceTab === "search"
        ? `/(tabs)/search/${libraryItemId}`
        : `/(tabs)/(home)/${libraryItemId}`;

    router.back();
    setTimeout(() => {
      router.push(destination);
    }, 0);
  };

  const title = filterValue ?? "Books";
  const filterLabel = filterType ? getFilterLabel(filterType) : "Filter";

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen options={{ headerTitle: title }} />
      <Stack.SearchBar
        placement="inline"
        placeholder="Search title or author"
        onChangeText={(e) => setSearchText(e.nativeEvent.text)}
      />

      {!filterType || !filterValue ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
        >
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 14, textAlign: "center" }}
          >
            Filter details are missing. Close and reopen the selected chip.
          </Text>
        </View>
      ) : (
        <FlashList
          data={filteredMatchingBooks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BookFlashListRow
              book={item}
              isOffline={isOffline}
              isFinished={Boolean(progressByLibraryItemId[item.id]?.isFinished)}
              onPress={() => handleBookPress(item.id)}
            />
          )}
          ListHeaderComponent={
            <View className="p-2 gap-1">
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                {filterLabel}: {filterValue}
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                {filteredMatchingBooks.length} cached{" "}
                {filteredMatchingBooks.length === 1 ? "book" : "books"}
                {normalizedSearchQuery ? ` (${matchingBooks.length} total matches)` : ""}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              {normalizedSearchQuery
                ? "No books match the current search."
                : `No cached books match this ${filterLabel.toLowerCase()}.`}
            </Text>
          }
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingTop: 12,
            paddingBottom: Math.max(24, insets.bottom + 12),
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};
