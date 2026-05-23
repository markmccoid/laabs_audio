import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { libraryItemsApi } from "../api/library-items-api";
import { playlistsApi } from "../api/playlists-api";
import { useAuthStore } from "../auth/auth-store";
import { useLibrarySelection } from "../hooks/use-library-selection";
import { getBookDetailHref } from "../navigation/book-links";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import { useThemeColors } from "../theme/use-app-theme";

export default function LibraryPickerScreen() {
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const { libraries, isLoading, isError, refetch, activeLibraryId, selectLibrary } =
    useLibrarySelection();
  const params = useLocalSearchParams<{ mode?: string; returnToLibraryItemId?: string | string[] }>();
  const themeColors = useThemeColors();
  const [selectedLibraryName, setSelectedLibraryName] = useState<string | null>(null);
  const [isPreparingLibrary, setIsPreparingLibrary] = useState(false);
  const showEmptyState = !libraries.length && !isLoading && !isError;
  const isSetup = params.mode === "setup";
  const returnToLibraryItemId = Array.isArray(params.returnToLibraryItemId)
    ? params.returnToLibraryItemId[0]
    : params.returnToLibraryItemId;

  const navigateAfterSetup = () => {
    if (returnToLibraryItemId) {
      router.replace(getBookDetailHref(returnToLibraryItemId));
      return;
    }

    router.replace("/(tabs)/(home)");
  };

  const prepareInitialLibraryData = async (libraryId: string) => {
    const prefetches: Promise<unknown>[] = [
      queryClient.prefetchQuery({
        queryKey: queryKeys.libraryBooks(libraryId),
        queryFn: () => libraryItemsApi.getItems({ libraryId }),
        meta: { persist: true },
      }),
    ];

    if (activeLibraryUserKey) {
      prefetches.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.userServerState(activeLibraryUserKey),
          queryFn: () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
          meta: { persist: true },
        }),
        queryClient.prefetchQuery({
          queryKey: queryKeys.libraryPlaylists(activeLibraryUserKey, libraryId),
          queryFn: () => playlistsApi.getLibraryPlaylists(libraryId),
          meta: { persist: true },
        }),
      );
    }

    await Promise.all(prefetches);
  };

  const handleSelect = async (id: string) => {
    if (isPreparingLibrary) return;
    const selected = libraries.find((library) => library.id === id);
    if (!selected) return;

    selectLibrary(selected);

    if (!isSetup) {
      setTimeout(() => router.back(), 750);
      return;
    }

    setSelectedLibraryName(selected.name);
    setIsPreparingLibrary(true);

    try {
      await prepareInitialLibraryData(selected.id);
    } catch {
      // Home still owns the visible error/empty states; this loading surface only bridges setup.
    } finally {
      navigateAfterSetup();
    }
  };

  if (isPreparingLibrary) {
    return (
      <View
        className="flex-1 items-center justify-center bg-bg px-8"
        style={{ backgroundColor: themeColors.bg }}
      >
        <View className="w-full max-w-md items-center rounded-2xl border border-border bg-surface px-6 py-8">
          <ActivityIndicator size="large" color={themeColors.accent} />
          <Text className="mt-5 text-center text-xl font-semibold text-text">
            Loading library
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-text-muted">
            {selectedLibraryName
              ? `Preparing ${selectedLibraryName} for your home screen.`
              : "Preparing your home screen."}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={libraries}
      keyExtractor={(library) => library.id}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: themeColors.bg }}
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}
      showsVerticalScrollIndicator
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      ListHeaderComponent={
        isError ? (
          <View className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-900">Unable to load libraries</Text>
            <Pressable
              onPress={() => refetch()}
              className="mt-3 self-start rounded-full bg-amber-900 px-3 py-1"
            >
              <Text className="text-xs font-semibold text-white">Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View className="border-b border-border px-6 pb-4 pt-5">
            <View className="flex-row items-center justify-between">
              <Text className="text-2xl font-semibold text-text">Choose library</Text>
              {isSetup ? null : (
                <Pressable
                  onPress={() => router.back()}
                  className="rounded-full bg-surface px-3 py-1"
                >
                  <Text className="text-sm text-text-muted">Close</Text>
                </Pressable>
              )}
            </View>
            <Text className="mt-2 text-sm text-text-muted">
              {isSetup
                ? "Select a library to finish signing in."
                : "Select the library you want to browse."}
            </Text>
          </View>
        )
      }
      ListHeaderComponentStyle={isError ? { marginBottom: 12 } : undefined}
      ListEmptyComponent={
        showEmptyState ? (
          <Text className="text-sm text-text-muted">No libraries available.</Text>
        ) : null
      }
      renderItem={({ item }) => {
        const isActive = item.id === activeLibraryId;
        return (
          <Pressable
            onPress={() => handleSelect(item.id)}
            disabled={isPreparingLibrary}
            className={
              isActive
                ? "rounded-2xl border border-accent bg-accent px-4 py-3"
                : "rounded-2xl border border-border bg-surface px-4 py-3"
            }
          >
            <Text
              className={
                isActive
                  ? "text-base font-semibold text-accent-foreground"
                  : "text-base font-semibold text-text"
              }
            >
              {item.name}
            </Text>
            <Text
              className={
                isActive ? "mt-1 text-xs text-accent-foreground/85" : "mt-1 text-xs text-text-muted"
              }
            >
              {item.mediaType} • {item.icon || item.provider}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
