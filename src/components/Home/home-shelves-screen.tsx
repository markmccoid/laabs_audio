import { libraryItemsApi } from "@/api/library-items-api";
import { meApi } from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { type HomeShelf, useHomeShelves } from "@/hooks/use-home-shelves";
import { queryKeys } from "@/query/query-keys";
import { useThemeColors } from "@/theme/use-app-theme";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { HomeShelfSection } from "./home-shelf-section";

const HomeShelvesScreen = () => {
  const themeColors = useThemeColors();
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOnline = useAuthStore((state) => state.isOnline);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const { visibleShelves, refreshDiscover } = useHomeShelves();

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    if (isOnline === false) {
      setRefreshMessage("You are offline. Connect to refresh books and progress.");
      return;
    }
    if (!activeLibraryId || !activeLibraryUserKey) {
      setRefreshMessage("Library context is not ready yet. Try again in a moment.");
      return;
    }

    setIsRefreshing(true);
    setRefreshMessage(null);

    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.libraryBooks(activeLibraryId),
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.userServerState(activeLibraryUserKey),
          exact: true,
        }),
      ]);

      await Promise.all([
        queryClient.fetchQuery({
          queryKey: queryKeys.libraryBooks(activeLibraryId),
          queryFn: () => libraryItemsApi.getItems({ libraryId: activeLibraryId }),
          meta: { persist: true },
        }),
        queryClient.fetchQuery({
          queryKey: queryKeys.userServerState(activeLibraryUserKey),
          queryFn: () => meApi.getUserServerState(),
          meta: { persist: true },
        }),
      ]);
    } catch {
      setRefreshMessage("Refresh failed. Pull down to try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [activeLibraryId, activeLibraryUserKey, isOnline, isRefreshing, queryClient]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="box.truck" />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24, gap: 22 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor={themeColors.accent}
          />
        }
      >
        {refreshMessage ? (
          <View
            style={{
              marginHorizontal: 18,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
            }}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              {refreshMessage}
            </Text>
          </View>
        ) : null}

        {visibleShelves.map((shelf: HomeShelf) => (
          <HomeShelfSection
            key={shelf.id}
            title={shelf.title}
            books={shelf.books}
            isOffline={isOnline === false}
            emptyMessage={shelf.emptyMessage}
            shelfHref={{
              pathname: "/(tabs)/(home)/bookshelf/[shelfId]",
              params: { shelfId: shelf.id },
            }}
            onRefresh={
              shelf.kind === "derived" && shelf.id === "discover" ? refreshDiscover : undefined
            }
          />
        ))}

        <Text
          selectable
          style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 18 }}
        >
          Shelf creation and book assignment are managed in Settings.
        </Text>
      </ScrollView>
    </View>
  );
};

export default HomeShelvesScreen;
