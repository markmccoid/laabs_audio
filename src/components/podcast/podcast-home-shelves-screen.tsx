import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { HomeShelfSection } from "@/components/Home/home-shelf-section";
import { useHomeSignInSwitcher } from "@/components/Home/home-sign-in-switcher";
import { PodcastContinueShelf } from "@/components/podcast/podcast-continue-shelf";
import { useActivateLibrarySelection } from "@/hooks/use-activate-library-selection";
import { useLibrarySelection } from "@/hooks/use-library-selection";
import { usePlaybackStore } from "@/player/playback-store";
import type { TouchedEpisodeProgress } from "@/podcast/episode-continue-eligibility";
import { applyActiveEpisodePlaybackOverlay, toContinueShelfItemFromRecent } from "@/podcast/recent-episodes-shelf";
import { podcastShowToShelfSummary } from "@/podcast/podcast-show-to-shelf-summary";
import { refreshPodcastHomeShelvesDefault } from "@/podcast/podcast-library-experience-default";
import {
  usePodcastContinueEpisodes,
  usePodcastRecentEpisodes,
  usePodcastSeriesByAddedAt,
} from "@/podcast/use-podcast-series";
import { queryKeys } from "@/query/query-keys";
import {
  selectDownloadedEpisodesShelf,
  useDeviceEpisodeDownloadsStore,
} from "@/store/device-episode-downloads-store";
import {
  HOME_PREVIEW_SIZE_LARGE,
  HOME_PREVIEW_SIZE_MEDIUM,
  HOME_PREVIEW_SIZE_SMALL,
  useSettingsStore,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import type { UserBookProgress } from "@/api/me-api";
import type { Library } from "@/types/absTypes";
import { FlashList, type FlashListProps } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

const EMPTY_FAVORITES: Record<string, true> = {};
const EMPTY_PROGRESS: Record<string, UserBookProgress> = {};

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as <TItem>(
  props: FlashListProps<TItem>,
) => ReactElement;

type PodcastHomeListItem =
  | { type: "refresh-message"; id: "refresh-message"; message: string }
  | { type: "continue"; id: "continue" }
  | { type: "recent"; id: "recent" }
  | { type: "shelf"; id: "podcasts" }
  | { type: "downloaded"; id: "downloaded" };

export const PodcastHomeShelvesScreen = () => {
  const headerHeight = useHeaderHeight();
  const themeColors = useThemeColors();
  const queryClient = useQueryClient();
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const authStatus = useAuthStore((state) => state.status);
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const homePreviewSize = useSettingsStore((state) => state.homePreviewSize);
  const setHomePreviewSize = useSettingsStore((state) => state.actions.setHomePreviewSize);
  const homeShowTitles = useSettingsStore((state) => state.homeShowTitles);
  const setHomeShowTitles = useSettingsStore((state) => state.actions.setHomeShowTitles);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const scrollY = useSharedValue(0);
  const seriesQuery = usePodcastSeriesByAddedAt();
  const continueQuery = usePodcastContinueEpisodes();
  const recentQuery = usePodcastRecentEpisodes();
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackEpisodeId = usePlaybackStore((state) => state.episodeId);
  const playbackPositionMs = usePlaybackStore((state) => state.positionMs);
  const playbackDurationMs = usePlaybackStore((state) => state.durationMs);
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

  const shows = seriesQuery.data ?? [];
  const shelfBooks = useMemo(() => shows.map(podcastShowToShelfSummary), [shows]);

  const activePlaybackOverlay = useMemo(() => {
    if (!playbackLibraryItemId || !playbackEpisodeId) return null;
    return {
      libraryItemId: playbackLibraryItemId,
      episodeId: playbackEpisodeId,
      currentTimeSeconds: Math.max(0, playbackPositionMs / 1000),
      durationSeconds: Math.max(0, playbackDurationMs / 1000),
    };
  }, [playbackDurationMs, playbackEpisodeId, playbackLibraryItemId, playbackPositionMs]);

  const continueEpisodes = useMemo(
    () => applyActiveEpisodePlaybackOverlay(continueQuery.data ?? [], activePlaybackOverlay),
    [activePlaybackOverlay, continueQuery.data],
  );

  const recentEpisodes = useMemo(() => {
    const assembled = recentQuery.data ?? [];
    const withOverlay = applyActiveEpisodePlaybackOverlay(assembled, activePlaybackOverlay);
    return withOverlay.map(toContinueShelfItemFromRecent);
  }, [activePlaybackOverlay, recentQuery.data]);

  const downloadedEpisodes = useDeviceEpisodeDownloadsStore((state) =>
    selectDownloadedEpisodesShelf(state, activeLibraryUserKey),
  );

  const downloadedShelfEpisodes = useMemo((): TouchedEpisodeProgress[] => {
    return downloadedEpisodes.map((episode) => ({
      libraryItemId: episode.libraryItemId,
      episodeId: episode.episodeId,
      title: episode.title,
      podcastTitle: episode.podcastTitle,
      cover: episode.cover,
      currentTimeSeconds: 0,
      durationSeconds: episode.durationSeconds,
      isFinished: false,
      hideFromContinueListening: false,
      lastUpdate: episode.downloadedAt,
    }));
  }, [downloadedEpisodes]);

  const listData = useMemo<PodcastHomeListItem[]>(() => {
    return [
      ...(refreshMessage
        ? [{ type: "refresh-message" as const, id: "refresh-message" as const, message: refreshMessage }]
        : []),
      ...(continueEpisodes.length > 0
        ? [{ type: "continue" as const, id: "continue" as const }]
        : []),
      ...(recentEpisodes.length > 0 ? [{ type: "recent" as const, id: "recent" as const }] : []),
      { type: "shelf", id: "podcasts" },
      ...(downloadedShelfEpisodes.length > 0
        ? [{ type: "downloaded" as const, id: "downloaded" as const }]
        : []),
    ];
  }, [
    continueEpisodes.length,
    downloadedShelfEpisodes.length,
    recentEpisodes.length,
    refreshMessage,
  ]);

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
      setRefreshMessage("Library context is not ready yet. Try again in a moment.");
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
      if (result.recent.source === "snapshot" || result.recent.source === "empty") {
        setRefreshMessage("Could not refresh Recent Episodes. Showing the last saved shelf.");
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastRecentEpisodes(activeLibraryUserKey, activeLibraryId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastContinueEpisodes(activeLibraryUserKey, activeLibraryId),
      });
      if (result.seriesIndexRefreshed) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "addedAtDesc"),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "titleAsc"),
        });
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
    queryClient,
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
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              {item.message}
            </Text>
          </View>
        );
      }

      if (item.type === "continue") {
        return (
          <PodcastContinueShelf episodes={continueEpisodes} bookSizeMultiplier={1.25} />
        );
      }

      if (item.type === "recent") {
        return (
          <PodcastContinueShelf
            title="Recent Episodes"
            episodes={recentEpisodes}
            bookSizeMultiplier={1.25}
          />
        );
      }

      if (item.type === "downloaded") {
        return (
          <PodcastContinueShelf
            title="Downloaded"
            episodes={downloadedShelfEpisodes}
            bookSizeMultiplier={1.25}
          />
        );
      }

      return (
        <HomeShelfSection
          shelfId="podcasts"
          title="Podcasts"
          books={shelfBooks}
          favoriteByBookId={EMPTY_FAVORITES}
          progressByBookId={EMPTY_PROGRESS}
          isOffline={isOnline === false}
          emptyMessage={
            seriesQuery.isLoading
              ? "Loading podcasts…"
              : "No podcasts in this Library yet."
          }
          headerHeight={headerHeight}
          shelfHref="/(tabs)/library"
          renderCardMenus={false}
          scrollY={scrollY}
          bookSizeMultiplier={1.25}
        />
      );
    },
    [
      continueEpisodes,
      downloadedShelfEpisodes,
      headerHeight,
      isOnline,
      recentEpisodes,
      scrollY,
      seriesQuery.isLoading,
      shelfBooks,
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
      <View style={{ flex: 1, backgroundColor: themeColors.bg, alignItems: "center", justifyContent: "center" }}>
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

      <AnimatedFlashList
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
