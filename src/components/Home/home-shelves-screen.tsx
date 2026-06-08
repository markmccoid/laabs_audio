import { playlistsApi } from "@/api/playlists-api";
import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import { type HomeShelf, useHomeShelves } from "@/hooks/use-home-shelves";
import { useActivateLibrarySelection } from "@/hooks/use-activate-library-selection";
import { useLibrarySelection } from "@/hooks/use-library-selection";
import { queryKeys } from "@/query/query-keys";
import {
  HOME_PREVIEW_SIZE_LARGE,
  HOME_PREVIEW_SIZE_MEDIUM,
  HOME_PREVIEW_SIZE_SMALL,
  useSettingsStore,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Library } from "@/types/absTypes";
import {
  logStartupDuration,
  markStartup,
  recordHomeShelfDisplay,
} from "@/utils/dev-startup-tracing";
import { markStartupPresentation } from "@/utils/startup-presentation";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, InteractionManager, RefreshControl, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { HomeShelfSection } from "./home-shelf-section";

const HomeShelvesScreen = () => {
  const headerHeight = useHeaderHeight();
  const themeColors = useThemeColors();
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const authStatus = useAuthStore((state) => state.status);
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const setHomePreviewSize = useSettingsStore((state) => state.actions.setHomePreviewSize);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [shouldRenderCardMenus, setShouldRenderCardMenus] = useState(false);
  const hasHomeScope =
    Boolean(activeLibraryId) ||
    accessMode === "downloadedOnly" ||
    accessMode === "downloadedSessionOnly";
  const {
    catalogCount,
    isCatalogLoading,
    progressCount,
    visibleShelves,
    visibleBookCount,
    favoriteByBookId,
    progressByBookId,
    refreshDiscover,
  } = useHomeShelves();
  const activateLibrarySelection = useActivateLibrarySelection();
  const {
    libraries,
    isLoading: isLibrariesLoading,
    isError: isLibrariesError,
    refetch: refetchLibraries,
  } = useLibrarySelection();
  const canChangeLibrary = authStatus === "authenticated";
  const scrollY = useSharedValue(0);
  const didMarkHomeShelfDisplayRef = useRef(false);
  const renderStartedAtMs = useMemo(
    () => markStartup("home-shelves-screen-render-start"),
    [],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

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
        sqliteRefreshCoordinator.refreshActiveLibrary(
          { userId: activeLibraryUserKey, libraryId: activeLibraryId },
          { forceCatalog: true, forceOverlay: true, queryClient },
        ),
        queryClient.invalidateQueries({
          queryKey: queryKeys.libraryPlaylists(activeLibraryUserKey, activeLibraryId),
          exact: true,
        }),
      ]);

      await queryClient.fetchQuery({
        queryKey: queryKeys.libraryPlaylists(activeLibraryUserKey, activeLibraryId),
        queryFn: () => playlistsApi.getLibraryPlaylists(activeLibraryId),
        meta: { persist: true },
      });
    } catch {
      setRefreshMessage("Refresh failed. Pull down to try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [activeLibraryId, activeLibraryUserKey, isOnline, isRefreshing, queryClient]);

  const handleLibraryChange = useCallback(
    (library: Library) => {
      if (library.id === activeLibraryId) return;
      setRefreshMessage(null);
      void activateLibrarySelection(library);
    },
    [activateLibrarySelection, activeLibraryId],
  );

  useEffect(() => {
    if (!hasHomeScope || shouldRenderCardMenus) return;

    const interactionTask = InteractionManager.runAfterInteractions(() => {
      setShouldRenderCardMenus(true);
    });

    return () => {
      interactionTask.cancel?.();
    };
  }, [hasHomeScope, shouldRenderCardMenus]);

  const handleHomeLayout = useCallback(() => {
    if (didMarkHomeShelfDisplayRef.current) return;
    if (!hasHomeScope) return;

    didMarkHomeShelfDisplayRef.current = true;
    logStartupDuration("home shelves render to layout", renderStartedAtMs, {
      accessMode,
      activeLibraryId,
      catalogCount,
      progressCount,
      shelfCount: visibleShelves.length,
      visibleBookCount,
    });
    const shelfCount = visibleShelves.length;
    markStartupPresentation("home-layout", {
      activeLibraryId,
      accessMode,
      catalogCount,
      progressCount,
      shelfCount,
      visibleBookCount,
    });
    recordHomeShelfDisplay({
      accessMode,
      activeLibraryId,
      catalogCount,
      progressCount,
      hasActiveLibraryUserKey: Boolean(activeLibraryUserKey),
      shelfCount,
      visibleBookCount,
      isOffline: isOnline === false,
    });

  }, [
    accessMode,
    activeLibraryId,
    activeLibraryUserKey,
    catalogCount,
    hasHomeScope,
    isOnline,
    progressCount,
    renderStartedAtMs,
    visibleBookCount,
    visibleShelves.length,
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }} onLayout={handleHomeLayout}>
      <Stack.Toolbar placement="right">
        {/* <Stack.Toolbar.Button icon="ellipsis" /> */}
        <Stack.Toolbar.Menu icon="ellipsis">
          {canChangeLibrary ? (
            <Stack.Toolbar.Menu icon="books.vertical.fill" title="Change Library">
              {isLibrariesLoading && libraries.length === 0 ? (
                <Stack.Toolbar.MenuAction disabled icon="ellipsis">
                  Loading libraries...
                </Stack.Toolbar.MenuAction>
              ) : null}
              {isLibrariesError && libraries.length === 0 ? (
                <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={() => refetchLibraries()}>
                  Retry loading libraries
                </Stack.Toolbar.MenuAction>
              ) : null}
              {!isLibrariesLoading && !isLibrariesError && libraries.length === 0 ? (
                <Stack.Toolbar.MenuAction disabled icon="books.vertical">
                  No libraries available
                </Stack.Toolbar.MenuAction>
              ) : null}
              {libraries.map((library) => (
                <Stack.Toolbar.MenuAction
                  key={library.id}
                  icon="text.book.closed.fill"
                  isOn={library.id === activeLibraryId}
                  onPress={() => handleLibraryChange(library)}
                  subtitle={`${library.mediaType} • ${library.icon || library.provider}`}
                >
                  {library.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          ) : null}
          <Stack.Toolbar.Menu icon="square.grid.2x2" title="View">
            <Stack.Toolbar.MenuAction
              icon="square.grid.2x2"
              isOn={homePreviewSize === HOME_PREVIEW_SIZE_SMALL}
              onPress={() => setHomePreviewSize(HOME_PREVIEW_SIZE_SMALL)}
            >
              Small
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="square.grid.2x2"
              isOn={homePreviewSize === HOME_PREVIEW_SIZE_MEDIUM}
              onPress={() => setHomePreviewSize(HOME_PREVIEW_SIZE_MEDIUM)}
            >
              Medium
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="square.grid.2x2"
              isOn={homePreviewSize === HOME_PREVIEW_SIZE_LARGE}
              onPress={() => setHomePreviewSize(HOME_PREVIEW_SIZE_LARGE)}
            >
              Large
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {isCatalogLoading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <ActivityIndicator color={themeColors.accent} />
          <Text
            selectable
            style={{
              marginTop: 12,
              color: themeColors.textMuted,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            Loading library
          </Text>
        </View>
      ) : (
        <Animated.ScrollView
          contentInsetAdjustmentBehavior="automatic"
          onScroll={scrollHandler}
          scrollEventThrottle={16}
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
              key={`${activeLibraryId ?? "no-library"}:${shelf.id}`}
              title={shelf.title}
              books={shelf.books}
              favoriteByBookId={favoriteByBookId}
              progressByBookId={progressByBookId}
              isOffline={isOnline === false}
              emptyMessage={shelf.emptyMessage}
              headerHeight={headerHeight}
              shelfHref={{
                pathname: "/(tabs)/(home)/bookshelf/[shelfId]",
                params: { shelfId: shelf.id },
              }}
              onRefresh={
                shelf.kind === "derived" && shelf.id === "discover" ? refreshDiscover : undefined
              }
              renderCardMenus={shouldRenderCardMenus}
              scrollY={scrollY}
            />
          ))}

          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 18 }}
          >
            Shelf creation and book assignment are managed in Settings.
          </Text>
        </Animated.ScrollView>
      )}
    </View>
  );
};

export default HomeShelvesScreen;
