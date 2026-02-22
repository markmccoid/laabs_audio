import { ThemeProvider } from "@react-navigation/native";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, router, useSegments } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Uniwind } from "uniwind";
import { libraryItemsApi } from "../api/library-items-api";
import { meApi } from "../api/me-api";
import { useAuthStore } from "../auth/auth-store";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import { LibrarySelectionGate } from "../components/library-selection-gate";
import { OfflineConnectionBanner } from "../components/offline-connection-banner";
import "../global.css";
import { playerService } from "../player/player-service";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { mmkvQueryPersister } from "../store/mmkv-query-persister";
import { useNavigationTheme, useThemeColors } from "../theme/use-app-theme";

export default function RootLayout() {
  const { status } = useAuthBootstrap();
  const navigationTheme = useNavigationTheme();
  const themeColors = useThemeColors();
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const segments = useSegments();
  const previousStatus = useRef<typeof status | null>(null);

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
    if (status === "hydrating") return;

    const rootSegment = segments[0];
    const inLogin = rootSegment === "login";
    const inTabs = rootSegment === "(tabs)";
    const inLibraryPicker = rootSegment === "library-picker";
    const inChapterViewer = rootSegment === "chapter-viewer";
    const inMainPlayer = rootSegment === "main-player";
    const inPlayerUtilitySheet =
      rootSegment === "player-rate" ||
      rootSegment === "player-bookmarks" ||
      rootSegment === "player-sleep-timer";
    const inBookUtilitySheet =
      rootSegment === "book-bookshelves" || rootSegment === "book-downloads";
    if (status === "anonymous" && !inLogin) {
      router.replace({ pathname: "/login", params: { mode: "required" } });
      return;
    }

    if (
      status !== "anonymous" &&
      !loginRequired &&
      !inTabs &&
      !inLibraryPicker &&
      !inChapterViewer &&
      !inMainPlayer &&
      !inPlayerUtilitySheet &&
      !inBookUtilitySheet
    ) {
      router.replace("/(tabs)/(home)");
    }
  }, [loginRequired, segments, status]);

  useEffect(() => {
    if (status === "hydrating") return;

    const prevStatus = previousStatus.current;

    // Clear persisted query data on logout transitions
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

    // Track current values for the next transition check
    previousStatus.current = status;
  }, [status]);

  useEffect(() => {
    playerService.init();
    return () => playerService.destroy();
  }, []);

  useEffect(() => {
    if (!loginRequired) return;
    if (status === "anonymous") return;
    const rootSegment = segments[0];
    if (rootSegment === "login") return;
    router.push({ pathname: "/login", params: { mode: "sheet" } });
  }, [loginRequired, segments, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const prefetches: Promise<unknown>[] = [];

    // Warm the catalog cache for Home/Search. Prefetch is stale-aware (5 minute query staleTime).
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
          <OfflineConnectionBanner />
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
                name="book-bookshelves"
                options={{
                  headerShown: false,
                  presentation: "modal",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.5],
                  sheetExpandsWhenScrolledToEdge: false,
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
                  headerShown: true,
                  presentation: "formSheet",
                  animation: "slide_from_bottom",
                  sheetAllowedDetents: [0.45, 0.9],
                  sheetExpandsWhenScrolledToEdge: false,
                  sheetGrabberVisible: true,
                  sheetCornerRadius: 20,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
            </Stack>
          </View>
        </GestureHandlerRootView>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
