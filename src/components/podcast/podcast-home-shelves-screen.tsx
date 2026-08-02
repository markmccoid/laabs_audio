import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { useHomeSignInSwitcher } from "@/components/Home/home-sign-in-switcher";
import { PodcastContinueShelf } from "@/components/podcast/podcast-continue-shelf";
import { PodcastHomeShelfSection } from "@/components/podcast/podcast-home-shelf-section";
import { useActivateLibrarySelection } from "@/hooks/use-activate-library-selection";
import { useLibrarySelection } from "@/hooks/use-library-selection";
import { usePodcastHomeShelves } from "@/hooks/use-podcast-home-shelves";
import { refreshPodcastHomeShelvesDefault } from "@/podcast/podcast-library-experience-default";
import { replayPendingPodcastPlaylistOperations } from "@/podcast/podcast-playlist-sync";
import type { PodcastHomeShelf } from "@/podcast/podcast-shelf-types";
import { queryKeys } from "@/query/query-keys";
import {
  HOME_PREVIEW_SIZE_LARGE,
  HOME_PREVIEW_SIZE_MEDIUM,
  HOME_PREVIEW_SIZE_SMALL,
  selectHomeShelfOrder,
  useSettingsStore,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { Library } from "@/types/absTypes";
import { FlashList, type FlashListProps } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";

const EPISODE_CARD_SIZE_MULTIPLIER = 1.25;

const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList,
) as unknown as <TItem>(props: FlashListProps<TItem>) => ReactElement;

type PodcastHomeListItem =
  | { type: "refresh-message"; id: "refresh-message"; message: string }
  | { type: "shelf"; id: string; shelf: PodcastHomeShelf };

export const PodcastHomeShelvesScreen = () => {
  const headerHeight = useHeaderHeight();
  const themeColors = useThemeColors();
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const authStatus = useAuthStore((state) => state.status);
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const setHomePreviewSize = useSettingsStore(
    (state) => state.actions.setHomePreviewSize,
  );
  const homeShowTitles = useSettingsStore((state) => state.homeShowTitles);
  const setHomeShowTitles = useSettingsStore(
    (state) => state.actions.setHomeShowTitles,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const scrollY = useSharedValue(0);
  const { visibleShelves, scope, scopeKey, playlistQuery } =
    usePodcastHomeShelves();
  const shelfOrder = useSettingsStore((state) =>
    selectHomeShelfOrder(state, scopeKey),
  );
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

  const listData = useMemo<PodcastHomeListItem[]>(() => {
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
      ...visibleShelves.map((shelf) => ({
        type: "shelf" as const,
        id: shelf.id,
        shelf,
      })),
    ];
  }, [refreshMessage, visibleShelves]);
  const homeListOrderKey = useMemo(
    () => `${scopeKey ?? "no-scope"}:${JSON.stringify(shelfOrder)}`,
    [scopeKey, shelfOrder],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    if (isOnline === false) {
      setRefreshMessage("You are offline. Connect to refresh podcasts.");
      return;
    }
    if (!activeLibraryId || !activeLibraryUserKey) {
      setRefreshMessage(
        "Library context is not ready yet. Try again in a moment.",
      );
      return;
    }

    setIsRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await refreshPodcastHomeShelvesDefault({
        userId: activeLibraryUserKey,
        libraryId: activeLibraryId,
        libraryName: activeLibraryName ?? "Podcast Library",
      });
      if (
        result.recent.source === "snapshot" ||
        result.recent.source === "empty"
      ) {
        setRefreshMessage(
          "Could not refresh Recent Episodes. Showing the last saved shelf.",
        );
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastRecentEpisodes(
          activeLibraryUserKey,
          activeLibraryId,
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastContinueEpisodes(
          activeLibraryUserKey,
          activeLibraryId,
        ),
      });
      if (result.seriesIndexRefreshed) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.podcastSeriesIndex(
            activeLibraryUserKey,
            activeLibraryId,
            "addedAtDesc",
          ),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.podcastSeriesIndex(
            activeLibraryUserKey,
            activeLibraryId,
            "titleAsc",
          ),
        });
      }
      const playlistResult = await playlistQuery.refetch();
      if (playlistResult.isError) {
        setRefreshMessage(
          "Podcast shelves refreshed, but Playlist Shelves could not be updated.",
        );
      }
      if (scope) {
        await replayPendingPodcastPlaylistOperations(scope);
      }
    } catch {
      setRefreshMessage("Refresh failed. Pull down to try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [
    activeLibraryId,
    activeLibraryName,
    activeLibraryUserKey,
    isOnline,
    isRefreshing,
    playlistQuery,
    queryClient,
    scope,
  ]);

  const handleLibraryChange = useCallback(
    (library: Library) => {
      if (library.id === activeLibraryId) return;
      setRefreshMessage(null);
      void activateLibrarySelection(library);
    },
    [activateLibrarySelection, activeLibraryId],
  );

  const renderItem = useCallback(
    ({ item }: { item: PodcastHomeListItem }) => {
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
            <Text
              selectable
              style={{ color: themeColors.textMuted, fontSize: 13 }}
            >
              {item.message}
            </Text>
          </View>
        );
      }

      if (item.shelf.kind !== "derivedPodcast") {
        return (
          <PodcastContinueShelf
            title={item.shelf.title}
            episodes={item.shelf.episodes}
            emptyMessage={item.shelf.emptyMessage}
            shelfHref={{
              pathname: "/(tabs)/(home)/bookshelf/[shelfId]",
              params: { shelfId: item.shelf.id },
            }}
            sizeMultiplier={EPISODE_CARD_SIZE_MULTIPLIER}
            headerHeight={headerHeight}
            scrollY={scrollY}
          />
        );
      }

      return (
        <PodcastHomeShelfSection
          title={item.shelf.title}
          podcasts={item.shelf.podcasts}
          emptyMessage={item.shelf.emptyMessage}
          shelfHref="/(tabs)/library"
        />
      );
    },
    [
      headerHeight,
      scrollY,
      themeColors.border,
      themeColors.surface,
      themeColors.textMuted,
    ],
  );

  const hasHomeScope =
    Boolean(activeLibraryId) ||
    accessMode === "downloadedOnly" ||
    accessMode === "downloadedSessionOnly";

  if (!hasHomeScope) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={themeColors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
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
                icon={
                  session.needsAttention
                    ? "exclamationmark.triangle"
                    : undefined
                }
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
        <Stack.Toolbar.Menu icon="ellipsis">
          {canChangeLibrary ? (
            <Stack.Toolbar.Menu
              icon="books.vertical.fill"
              title="Change Library"
            >
              {isLibrariesLoading && libraries.length === 0 ? (
                <Stack.Toolbar.MenuAction disabled icon="ellipsis">
                  Loading libraries...
                </Stack.Toolbar.MenuAction>
              ) : null}
              {isLibrariesError && libraries.length === 0 ? (
                <Stack.Toolbar.MenuAction
                  icon="arrow.clockwise"
                  onPress={() => refetchLibraries()}
                >
                  Retry loading libraries
                </Stack.Toolbar.MenuAction>
              ) : null}
              {!isLibrariesLoading &&
              !isLibrariesError &&
              libraries.length === 0 ? (
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

      <AnimatedFlashList
        key={homeListOrderKey}
        contentInsetAdjustmentBehavior="automatic"
        data={listData}
        keyExtractor={(item) => item.id}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
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
    </View>
  );
};
