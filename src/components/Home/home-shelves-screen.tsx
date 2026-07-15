import { playlistsApi } from "@/api/playlists-api";
import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { useLibraryActivationStore } from "@/auth/library-activation-store";
import { sqliteRefreshCoordinator } from "@/data/sqlite/refresh-coordinator";
import { useActivateLibrarySelection } from "@/hooks/use-activate-library-selection";
import { type HomeShelf, useHomeShelves } from "@/hooks/use-home-shelves";
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
import { FlashList, type FlashListProps } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, InteractionManager, RefreshControl, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { HomeShelfSection } from "./home-shelf-section";
import { useHomeSignInSwitcher } from "./home-sign-in-switcher";

type HomeShelvesListItem =
  | { type: "refresh-message"; id: "refresh-message"; message: string }
  | { type: "shelf"; id: string; shelf: HomeShelf }
  | { type: "footer"; id: "footer" };

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as <TItem>(
  props: FlashListProps<TItem>,
) => ReactElement;

const HomeShelvesItemSeparator = () => <View style={{ height: 10 }} />;

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
  const homeShowTitles = useSettingsStore((state) => state.homeShowTitles);
  const setHomeShowTitles = useSettingsStore((state) => state.actions.setHomeShowTitles);
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
  const activationProgress = useLibraryActivationStore((state) => state.progress);
  const activateLibrarySelection = useActivateLibrarySelection();
  const {
    libraries,
    isLoading: isLibrariesLoading,
    isError: isLibrariesError,
    refetch: refetchLibraries,
  } = useLibrarySelection();
  const canChangeLibrary = authStatus === "authenticated";
  const {
    storedUsername,
    buttonLabel,
    activeSession,
    activeColor,
    otherSessions,
    switchTo,
    openAdd,
    openManage,
  } = useHomeSignInSwitcher();
  const scrollY = useSharedValue(0);
  const didMarkHomeShelfDisplayRef = useRef(false);
  const renderStartedAtMs = useMemo(() => markStartup("home-shelves-screen-render-start"), []);
  const homeListData = useMemo<HomeShelvesListItem[]>(() => {
    const shelfItems = visibleShelves.map((shelf) => ({
      type: "shelf" as const,
      id: `${activeLibraryId ?? "no-library"}:${shelf.id}`,
      shelf,
    }));

    return [
      ...(refreshMessage
        ? [
            {
              type: "refresh-message" as const,
              id: "refresh-message" as const,
              message: refreshMessage,
            },
          ]
        : []),
      ...shelfItems,
      { type: "footer", id: "footer" },
    ];
  }, [activeLibraryId, refreshMessage, visibleShelves]);

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

  const renderHomeListItem = useCallback(
    ({ item }: { item: HomeShelvesListItem }) => {
      if (item.type === "refresh-message") {
        return (
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
              {item.message}
            </Text>
          </View>
        );
      }

      if (item.type === "footer") {
        return (
          <Text
            selectable
            style={{
              color: themeColors.textMuted,
              fontSize: 13,
              paddingHorizontal: 18,
            }}
          >
            Shelf creation and book assignment are managed in Settings.
          </Text>
        );
      }

      const { shelf } = item;
      return (
        <HomeShelfSection
          shelfId={item.id}
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
      );
    },
    [
      favoriteByBookId,
      headerHeight,
      isOnline,
      progressByBookId,
      refreshDiscover,
      scrollY,
      shouldRenderCardMenus,
      themeColors.border,
      themeColors.surface,
      themeColors.textMuted,
    ],
  );

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }} onLayout={handleHomeLayout}>
      {storedUsername ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Menu tintColor={activeColor}>
            <Stack.Toolbar.Label>{buttonLabel}</Stack.Toolbar.Label>
            {activeSession ? (
              <Stack.Toolbar.MenuAction isOn onPress={() => {}}>
                {activeSession.label}
              </Stack.Toolbar.MenuAction>
            ) : null}
            {otherSessions.map((session) => (
              <Stack.Toolbar.MenuAction
                key={session.key}
                icon={session.needsAttention ? "exclamationmark.triangle" : undefined}
                onPress={() => void switchTo(session)}
              >
                {session.label}
              </Stack.Toolbar.MenuAction>
            ))}
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction icon="plus" onPress={openAdd}>
                Add Sign-In
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="gearshape" onPress={openManage}>
                Manage Sign-Ins
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
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

          <Stack.Toolbar.MenuAction
            icon={homeShowTitles ? "textformat" : "textformat.size"}
            onPress={() => setHomeShowTitles(!homeShowTitles)}
          >
            {homeShowTitles ? "Hide Titles" : "Show Titles"}
          </Stack.Toolbar.MenuAction>
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

          {activationProgress && activationProgress.totalExpected > 0 ? (
            <View
              style={{
                width: "100%",
                maxWidth: 320,
                marginTop: 24,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: themeColors.textMuted,
                  fontSize: 13,
                  fontWeight: "500",
                  marginBottom: 8,
                }}
              >
                Loading books {activationProgress.totalSeen} of {activationProgress.totalExpected}
              </Text>
              <View
                style={{
                  width: "100%",
                  height: 6,
                  backgroundColor: themeColors.border,
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, (activationProgress.totalSeen / activationProgress.totalExpected) * 100))}%`,
                    backgroundColor: themeColors.accent,
                  }}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <AnimatedFlashList
          contentInsetAdjustmentBehavior="automatic"
          data={homeListData}
          keyExtractor={(item) => item.id}
          getItemType={(item) => item.type}
          renderItem={renderHomeListItem}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
          ItemSeparatorComponent={HomeShelvesItemSeparator}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                void handleRefresh();
              }}
              tintColor={themeColors.accent}
            />
          }
        />
      )}
    </View>
  );
};

export default HomeShelvesScreen;
