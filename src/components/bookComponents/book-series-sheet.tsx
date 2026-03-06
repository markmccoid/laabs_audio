import type { LibraryItemsSummary, LibraryItemSummary } from "@/api/library-items-api";
import type { UserBookProgress } from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { BookFlashListRow } from "@/components/books/book-flashlist-row";
import { useGetSeriesWithProgress, useGetUserServerState } from "@/hooks/abs-data-hooks";
import { queryKeys } from "@/query/query-keys";
import { useThemeColors } from "@/theme/use-app-theme";
import { FlashList } from "@shopify/flash-list";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

type SourceTab = "home" | "search";

export const BookSeriesSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const isOffline = useAuthStore((state) => state.isOnline === false);
  const { data: userServerState } = useGetUserServerState();
  const queryClient = useQueryClient();
  const {
    seriesId: seriesIdParam,
    seriesName: seriesNameParam,
    sourceTab: sourceTabParam,
  } = useLocalSearchParams<{
    seriesId?: string | string[];
    seriesName?: string | string[];
    sourceTab?: string | string[];
  }>();
  const seriesId = resolveParam(seriesIdParam);
  const seriesName = resolveParam(seriesNameParam) ?? "Series";
  const sourceTabParamResolved = resolveParam(sourceTabParam);
  const sourceTab: SourceTab = sourceTabParamResolved === "search" ? "search" : "home";
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
  const {
    data: seriesWithProgress,
    isLoading,
    isError,
    refetch,
  } = useGetSeriesWithProgress(seriesId);

  const progressByLibraryItemId =
    userServerState?.progressByLibraryItemId ??
    (
      userServerState as typeof userServerState & {
        progressByBookId?: Record<string, UserBookProgress>;
      }
    )?.progressByBookId ??
    {};
  const seriesLibraryItemIds = useMemo(
    () => seriesWithProgress?.progress?.libraryItemIds ?? [],
    [seriesWithProgress?.progress?.libraryItemIds],
  );
  const seriesBooks = useMemo(() => {
    if (!seriesLibraryItemIds.length || !catalog.length) return [];
    const catalogById = new Map(catalog.map((item) => [item.id, item]));
    return seriesLibraryItemIds
      .map((libraryItemId) => catalogById.get(libraryItemId))
      .filter((book): book is LibraryItemSummary => Boolean(book));
  }, [catalog, seriesLibraryItemIds]);

  const missingBooksCount = Math.max(0, seriesLibraryItemIds.length - seriesBooks.length);

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

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Screen options={{ headerTitle: seriesName }} />

      {!seriesId ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
        >
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 14, textAlign: "center" }}
          >
            Series ID is missing. Close and reopen the series list.
          </Text>
        </View>
      ) : isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Loading series books...
          </Text>
        </View>
      ) : isError ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
            gap: 10,
          }}
        >
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 14, textAlign: "center" }}
          >
            Could not load this series right now.
          </Text>
          <Pressable
            onPress={() => {
              void refetch();
            }}
            style={({ pressed }) => ({
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.accent,
              backgroundColor: themeColors.accent,
              paddingHorizontal: 14,
              paddingVertical: 9,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text selectable style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlashList
          data={seriesBooks}
          keyExtractor={(item) => item.id}
          // estimatedItemSize={116}
          renderItem={({ item }) => (
            <BookFlashListRow
              book={item}
              isOffline={isOffline}
              isFinished={Boolean(progressByLibraryItemId[item.id]?.isFinished)}
              onPress={() => handleBookPress(item.id)}
            />
          )}
          // ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={
            <View className="p-2 gap-1">
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                {seriesWithProgress?.name ?? seriesName}
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                {seriesBooks.length} cached {seriesBooks.length === 1 ? "book" : "books"}
                {missingBooksCount > 0 ? ` (${missingBooksCount} unavailable offline)` : ""}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              {seriesLibraryItemIds.length === 0
                ? "No books found in this series."
                : "Series books are not available in the current catalog cache."}
            </Text>
          }
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            // paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(24, insets.bottom + 12),
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};
