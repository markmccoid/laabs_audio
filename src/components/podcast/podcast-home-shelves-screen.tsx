import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { HomeShelfSection } from "@/components/Home/home-shelf-section";
import { useHomeSignInSwitcher } from "@/components/Home/home-sign-in-switcher";
import { refreshPodcastSeriesIndex } from "@/data/sqlite/podcast-series-index-refresh";
import { useActivateLibrarySelection } from "@/hooks/use-activate-library-selection";
import { useLibrarySelection } from "@/hooks/use-library-selection";
import { podcastShowToShelfSummary } from "@/podcast/podcast-show-to-shelf-summary";
import { usePodcastSeriesByAddedAt } from "@/podcast/use-podcast-series";
import { queryKeys } from "@/query/query-keys";
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
  | { type: "shelf"; id: "podcasts" }
  | { type: "footer"; id: "footer" };

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

  const listData = useMemo<PodcastHomeListItem[]>(() => {
    return [
      ...(refreshMessage
        ? [{ type: "refresh-message" as const, id: "refresh-message" as const, message: refreshMessage }]
        : []),
      { type: "shelf", id: "podcasts" },
      { type: "footer", id: "footer" },
    ];
  }, [refreshMessage]);

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
      await refreshPodcastSeriesIndex({
        userId: activeLibraryUserKey,
        libraryId: activeLibraryId,
        libraryName: activeLibraryName ?? "Podcast Library",
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "addedAtDesc"),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.podcastSeriesIndex(activeLibraryUserKey, activeLibraryId, "titleAsc"),
      });
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
            Continue Listening, Recent Episodes, and Downloads land in upcoming podcast work.
          </Text>
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
      headerHeight,
      isOnline,
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
        {canChangeLibrary ? (
          <Stack.Toolbar.Menu icon="books.vertical">
            {isLibrariesLoading ? (
              <Stack.Toolbar.MenuAction disabled>Loading libraries…</Stack.Toolbar.MenuAction>
            ) : isLibrariesError ? (
              <Stack.Toolbar.MenuAction onPress={() => void refetchLibraries()}>
                Retry libraries
              </Stack.Toolbar.MenuAction>
            ) : (
              libraries.map((library) => (
                <Stack.Toolbar.MenuAction
                  key={library.id}
                  isOn={library.id === activeLibraryId}
                  onPress={() => handleLibraryChange(library)}
                >
                  {library.name}
                </Stack.Toolbar.MenuAction>
              ))
            )}
          </Stack.Toolbar.Menu>
        ) : null}
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction
              isOn={homePreviewSize === HOME_PREVIEW_SIZE_SMALL}
              onPress={() => setHomePreviewSize(HOME_PREVIEW_SIZE_SMALL)}
            >
              Small covers
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              isOn={homePreviewSize === HOME_PREVIEW_SIZE_MEDIUM}
              onPress={() => setHomePreviewSize(HOME_PREVIEW_SIZE_MEDIUM)}
            >
              Medium covers
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              isOn={homePreviewSize === HOME_PREVIEW_SIZE_LARGE}
              onPress={() => setHomePreviewSize(HOME_PREVIEW_SIZE_LARGE)}
            >
              Large covers
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction
            isOn={homeShowTitles}
            onPress={() => setHomeShowTitles(!homeShowTitles)}
          >
            Show titles
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <AnimatedFlashList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} />
        }
      />
    </View>
  );
};
