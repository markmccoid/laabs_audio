import { ThemeProvider } from "@react-navigation/native";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as Linking from "expo-linking";
import { Stack, router, useGlobalSearchParams, useSegments } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Toaster } from "react-native-sonner";
import { Uniwind } from "uniwind";
import { libraryItemsApi } from "../api/library-items-api";
import { meApi } from "../api/me-api";
import { useAuthStore } from "../auth/auth-store";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import { ActiveDownloadToastCoordinator } from "../components/bookComponents/active-download-toast-coordinator";
import { LibrarySelectionGate } from "../components/library-selection-gate";
import { OfflineConnectionBanner } from "../components/offline-connection-banner";
import { AmbientCoordinator } from "../ambient/ambient-coordinator";
import "../global.css";
import { playerService } from "../player/player-service";
import { SleepTimerCoordinator } from "../player/sleep-timer-coordinator";
import { extractBookDetailIdFromUrl } from "../navigation/book-links";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { mmkvQueryPersister } from "../store/mmkv-query-persister";
import {
  useApplyAccentThemeOverrides,
  useNavigationTheme,
  useThemeColors,
} from "../theme/use-app-theme";

const PLAYER_UTILITY_SHEETS = new Set([
  "player-rate",
  "player-bookmarks",
  "player-sleep-timer",
  "player-ambient",
]);
const BOOK_UTILITY_SHEETS = new Set([
  "book-bookshelves",
  "book-downloads",
  "book-bookmarks",
  "book-addbookmark",
  "book-series",
  "book-filter-results",
]);

const resolveParam = (value?: string | string[]) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
};

// Collapse the current top-level route into flags the navigation guard can reason about.
const getRouteState = (segments: string[]) => {
  const rootSegment = segments[0];

  return {
    rootSegment,
    inLogin: rootSegment === "login",
    inTabs: rootSegment === "(tabs)",
    inLibraryPicker: rootSegment === "library-picker",
    inChapterViewer: rootSegment === "chapter-viewer",
    inMainPlayer: rootSegment === "main-player",
    inPlayerUtilitySheet: Boolean(rootSegment && PLAYER_UTILITY_SHEETS.has(rootSegment)),
    inBookUtilitySheet: Boolean(rootSegment && BOOK_UTILITY_SHEETS.has(rootSegment)),
  };
};

// Recover the viewed book id when the router is already sitting on the Home detail route.
const getReturnToLibraryItemId = (
  segments: string[],
  globalParams: { libraryItemId?: string | string[] },
) =>
  segments[0] === "(tabs)" && segments[1] === "(home)" && segments[2] === "[libraryItemId]"
    ? resolveParam(globalParams.libraryItemId)
    : undefined;

export default function RootLayout() {
  useApplyAccentThemeOverrides();
  const { status } = useAuthBootstrap();
  const navigationTheme = useNavigationTheme();
  const themeColors = useThemeColors();
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const segments = useSegments();
  const globalParams = useGlobalSearchParams<{ libraryItemId?: string | string[] }>();
  const previousStatus = useRef<typeof status | null>(null);
  const [initialDeepLinkBookId, setInitialDeepLinkBookId] = useState<string | null | undefined>(
    undefined,
  );
  const routeState = useMemo(() => getRouteState(segments), [segments]);
  const returnToLibraryItemId = useMemo(
    () => getReturnToLibraryItemId(segments, globalParams),
    [globalParams, segments],
  );
  const startupBookLinkId = returnToLibraryItemId ?? initialDeepLinkBookId ?? undefined;

  // Persist only queries that opt-in via `meta.persist`
  const persistOptions = useMemo(
    () => ({
      persister: mmkvQueryPersister,
      maxAge: Infinity,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: { meta?: Record<string, unknown> }) =>
          query.meta?.persist === true,
      },
    }),
    [],
  );

  useEffect(() => {
    Uniwind.setTheme("system");
  }, []);

  useEffect(() => {
    // Read the cold-start URL once so startup navigation can avoid clobbering a deep link.
    let isMounted = true;

    Linking.getInitialURL()
      .then((initialUrl) => {
        if (!isMounted) return;
        setInitialDeepLinkBookId(extractBookDetailIdFromUrl(initialUrl) ?? null);
      })
      .catch(() => {
        if (!isMounted) return;
        setInitialDeepLinkBookId(null);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    // Once the router has entered tabs, the startup deep link has been handed off.
    if (initialDeepLinkBookId == null) return;
    if (!routeState.inTabs) return;

    setInitialDeepLinkBookId(null);
  }, [initialDeepLinkBookId, routeState.inTabs]);

  useEffect(() => {
    if (status === "hydrating") return;
    if (initialDeepLinkBookId === undefined) return;

    // Keep all auth and startup routing decisions in one place to avoid competing redirects.
    if (status === "anonymous" && !routeState.inLogin) {
      router.replace({
        pathname: "/login",
        params: {
          mode: "required",
          returnToLibraryItemId: startupBookLinkId,
        },
      });
      return;
    }

    if (loginRequired && status !== "anonymous" && !routeState.inLogin) {
      router.push({ pathname: "/login", params: { mode: "sheet" } });
      return;
    }

    const isKnownAuthenticatedRoute =
      routeState.inLogin ||
      routeState.inTabs ||
      routeState.inLibraryPicker ||
      routeState.inChapterViewer ||
      routeState.inMainPlayer ||
      routeState.inPlayerUtilitySheet ||
      routeState.inBookUtilitySheet;

    if (status !== "anonymous" && !loginRequired && !isKnownAuthenticatedRoute) {
      if (startupBookLinkId) {
        return;
      }
      router.replace("/(tabs)/(home)");
    }
  }, [initialDeepLinkBookId, loginRequired, routeState, startupBookLinkId, status]);

  useEffect(() => {
    if (status === "hydrating") return;

    const prevStatus = previousStatus.current;

    // Clear persisted query data on logout transitions.
    const didLogout = prevStatus !== null && prevStatus !== "anonymous" && status === "anonymous";
    if (didLogout) {
      queryClient.removeQueries({
        predicate: (query) => {
          const rootKey = query.queryKey[0];
          return (
            rootKey === "library" ||
            rootKey === "libraries" ||
            // Clean up legacy pre-refactor keys on fresh transitions.
            rootKey === "books" ||
            rootKey === "absfilterdata"
          );
        },
      });
    }

    // Track current values for the next transition check.
    previousStatus.current = status;
  }, [status]);

  useEffect(() => {
    playerService.init();
    return () => playerService.destroy();
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const prefetches: Promise<unknown>[] = [];

    // Warm the core catalog and user-state queries after auth is ready.
    if (activeLibraryId) {
      prefetches.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.libraryBooks(activeLibraryId),
          queryFn: () => libraryItemsApi.getItems({ libraryId: activeLibraryId }),
          meta: { persist: true },
        }),
      );
    }

    if (activeLibraryUserKey) {
      prefetches.push(
        queryClient.prefetchQuery({
          queryKey: queryKeys.userServerState(activeLibraryUserKey),
          queryFn: () => meApi.getUserServerState(),
          meta: { persist: true },
        }),
      );
    }

    if (!prefetches.length) return;
    Promise.all(prefetches).catch(() => undefined);
  }, [activeLibraryId, activeLibraryUserKey, status]);

  if (status === "hydrating") {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator size="large" color={themeColors.accent} />
      </View>
    );
  }

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ThemeProvider value={navigationTheme}>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: themeColors.bg }}>
          <LibrarySelectionGate />
          <ActiveDownloadToastCoordinator />
          <OfflineConnectionBanner />
          <SleepTimerCoordinator />
          <AmbientCoordinator />
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: themeColors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="login"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  // sheetAllowedDetents: [0.5, 0.9], // 50% and 90% of screen height
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="library-picker"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.5, 0.9], // 50% and 90% of screen height
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="chapter-viewer"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.5, 0.9], // 50% and 90% of screen height
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="main-player"
                options={{
                  presentation: "card",
                  headerShown: false,
                  gestureDirection: "vertical",
                  gestureEnabled: true,
                  contentStyle: {
                    borderTopLeftRadius: 25,
                    borderTopRightRadius: 25,
                    overflow: "hidden",
                  },
                }}
              />
              <Stack.Screen
                name="player-rate"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="player-bookmarks"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="player-sleep-timer"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="player-ambient"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-bookshelves"
                options={{
                  headerTitle: "Add To Bookshelf",
                  headerShown: true,
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-downloads"
                options={{
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-bookmarks"
                options={{
                  headerShown: false,
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-addbookmark"
                options={{
                  headerShown: false,
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.85],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-series"
                options={{
                  headerShown: true,
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.95],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-filter-results"
                options={{
                  headerShown: true,
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.95],
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
            </Stack>
          </View>
          <Toaster />
        </GestureHandlerRootView>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
