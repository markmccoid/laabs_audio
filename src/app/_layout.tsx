import type { QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as Linking from "expo-linking";
import { Stack, router, useGlobalSearchParams, useSegments } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, InteractionManager, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Toaster } from "react-native-sonner";
import { Uniwind } from "uniwind";
import { AmbientCoordinator } from "../ambient/ambient-coordinator";
import { libraryItemsApi } from "../api/library-items-api";
import { useAuthStore } from "../auth/auth-store";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import { ActiveDownloadToastCoordinator } from "../components/bookComponents/active-download-toast-coordinator";
import { LibrarySelectionGate } from "../components/library-selection-gate";
import { OfflineConnectionBanner } from "../components/offline-connection-banner";
import "../global.css";
import { extractBookDetailIdFromUrl } from "../navigation/book-links";
import { playerService } from "../player/player-service";
import { SleepTimerCoordinator } from "../player/sleep-timer-coordinator";
import { FIVE_MINUTES_MS, queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import { mmkvQueryPersister } from "../store/mmkv-query-persister";
import {
  useApplyAccentThemeOverrides,
  useNavigationTheme,
  useThemeColors,
} from "../theme/use-app-theme";
import { logStartupDuration, logStartupEvent, markStartup } from "../utils/dev-startup-tracing";
import {
  getStartupPresentationState,
  subscribeStartupPresentation,
} from "../utils/startup-presentation";

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

const logStartupDebug = (event: string, payload?: Record<string, unknown>) => {
  void event;
  void payload;
};

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const resolveParam = (value?: string | string[]) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
};

const getWarmQueryState = (queryKey: QueryKey) => {
  const state = queryClient.getQueryState(queryKey);

  if (!state) {
    return {
      cacheState: "missing",
      isStale: true,
      dataUpdatedAt: null,
    } as const;
  }

  const hasData = state.data !== undefined;
  const isStale =
    !hasData ||
    state.isInvalidated ||
    state.dataUpdatedAt <= 0 ||
    Date.now() - state.dataUpdatedAt > FIVE_MINUTES_MS;

  return {
    cacheState: hasData ? "present" : "empty",
    isStale,
    dataUpdatedAt: state.dataUpdatedAt || null,
  } as const;
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
  const queryRestoreStartedAtMsRef = useRef<number | null>(null);
  const splashHiddenRef = useRef(false);
  const [initialDeepLinkBookId, setInitialDeepLinkBookId] = useState<string | null | undefined>(
    undefined,
  );
  const [hasPresentedInitialContent, setHasPresentedInitialContent] = useState(
    () => getStartupPresentationState().hasPresentedInitialContent,
  );
  const [queryRestoreReady, setQueryRestoreReady] = useState(false);
  const routeState = useMemo(() => getRouteState(segments), [segments]);
  const returnToLibraryItemId = useMemo(
    () => getReturnToLibraryItemId(segments, globalParams),
    [globalParams, segments],
  );
  const startupBookLinkId = returnToLibraryItemId ?? initialDeepLinkBookId ?? undefined;
  const renderReady = status !== "hydrating";
  const warmupEligible =
    renderReady &&
    initialDeepLinkBookId !== undefined &&
    queryRestoreReady &&
    hasPresentedInitialContent;

  const hideNativeSplash = useCallback(() => {
    if (splashHiddenRef.current) {
      logStartupDebug("hideNativeSplash:skipped-already-hidden");
      return;
    }

    logStartupDebug("hideNativeSplash:attempt", {
      status,
      initialDeepLinkBookId,
      queryRestoreReady,
      hasPresentedInitialContent,
      renderReady,
    });
    splashHiddenRef.current = true;
    SplashScreen.hideAsync()
      .then(() => {
        logStartupDebug("hideNativeSplash:success");
        logStartupEvent("native splash hidden");
      })
      .catch(() => {
        logStartupDebug("hideNativeSplash:error");
        splashHiddenRef.current = false;
      });
  }, [hasPresentedInitialContent, initialDeepLinkBookId, queryRestoreReady, renderReady, status]);

  const handleQueryRestoreSuccess = useCallback(() => {
    logStartupDebug("queryRestore:success", {
      queryCount: queryClient.getQueryCache().getAll().length,
    });
    setQueryRestoreReady(true);
    logStartupDuration("query restore complete", queryRestoreStartedAtMsRef.current, {
      restoredQueryCount: queryClient.getQueryCache().getAll().length,
    });
  }, []);

  const handleQueryRestoreError = useCallback(() => {
    logStartupDebug("queryRestore:error", {
      queryCount: queryClient.getQueryCache().getAll().length,
    });
    setQueryRestoreReady(true);
    logStartupDuration("query restore failed", queryRestoreStartedAtMsRef.current, {
      restoredQueryCount: queryClient.getQueryCache().getAll().length,
    });
  }, []);

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
    queryRestoreStartedAtMsRef.current = markStartup("query-restore-start");
    logStartupEvent("query restore start");
    logStartupDebug("queryRestore:start");
  }, []);

  useEffect(
    () =>
      subscribeStartupPresentation(() => {
        logStartupDebug("startupPresentation:update", getStartupPresentationState());
        setHasPresentedInitialContent(getStartupPresentationState().hasPresentedInitialContent);
      }),
    [],
  );

  useEffect(() => {
    // Read the cold-start URL once so startup navigation can avoid clobbering a deep link.
    let isMounted = true;
    let didResolveInitialUrl = false;
    const unresolvedUrlTimer = setTimeout(() => {
      if (!didResolveInitialUrl) {
        logStartupDebug("initialUrl:still-pending", {
          status,
          renderReady,
        });
      }
    }, 3000);

    logStartupDebug("initialUrl:request");

    Linking.getInitialURL()
      .then((initialUrl) => {
        didResolveInitialUrl = true;
        clearTimeout(unresolvedUrlTimer);
        if (!isMounted) return;
        logStartupDebug("initialUrl:resolved", {
          initialUrl,
          extractedLibraryItemId: extractBookDetailIdFromUrl(initialUrl) ?? null,
        });
        setInitialDeepLinkBookId(extractBookDetailIdFromUrl(initialUrl) ?? null);
      })
      .catch((error) => {
        didResolveInitialUrl = true;
        clearTimeout(unresolvedUrlTimer);
        if (!isMounted) return;
        logStartupDebug("initialUrl:error", {
          error: error instanceof Error ? error.message : String(error),
        });
        setInitialDeepLinkBookId(null);
      });

    return () => {
      isMounted = false;
      clearTimeout(unresolvedUrlTimer);
    };
  }, [renderReady, status]);

  useEffect(() => {
    // Once the router has entered tabs, the startup deep link has been handed off.
    if (initialDeepLinkBookId == null) return;
    if (!routeState.inTabs) return;

    logStartupDebug("initialUrl:handoff-complete", {
      initialDeepLinkBookId,
      routeState,
    });
    setInitialDeepLinkBookId(null);
  }, [initialDeepLinkBookId, routeState]);

  const handleAppTreeLayout = useCallback(() => {
    logStartupDebug("appTree:onLayout", {
      renderReady,
      status,
      initialDeepLinkBookId,
      queryRestoreReady,
      hasPresentedInitialContent,
    });
    if (!renderReady) return;
    hideNativeSplash();
  }, [
    hasPresentedInitialContent,
    hideNativeSplash,
    initialDeepLinkBookId,
    queryRestoreReady,
    renderReady,
    status,
  ]);

  useEffect(() => {
    logStartupDebug("renderGate:update", {
      status,
      initialDeepLinkBookId,
      queryRestoreReady,
      hasPresentedInitialContent,
      renderReady,
      warmupEligible,
      routeState,
    });
    if (!renderReady) return;

    const frameId = requestAnimationFrame(() => {
      logStartupDebug("renderGate:animation-frame");
      hideNativeSplash();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [
    hasPresentedInitialContent,
    hideNativeSplash,
    initialDeepLinkBookId,
    queryRestoreReady,
    renderReady,
    routeState,
    status,
    warmupEligible,
  ]);

  useEffect(() => {
    if (status === "hydrating") return;
    if (initialDeepLinkBookId === undefined) return;

    logStartupDebug("routeGate:evaluate", {
      status,
      loginRequired,
      routeState,
      startupBookLinkId,
      initialDeepLinkBookId,
    });

    // Keep all auth and startup routing decisions in one place to avoid competing redirects.
    if (status === "anonymous" && !routeState.inLogin) {
      logStartupDebug("routeGate:redirect-login-required", {
        startupBookLinkId,
      });
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
      logStartupDebug("routeGate:push-login-sheet");
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
        logStartupDebug("routeGate:holding-for-deeplink", {
          startupBookLinkId,
        });
        return;
      }
      logStartupDebug("routeGate:redirect-home");
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
    if (!warmupEligible) return;

    let isCancelled = false;
    let interactionTask: { cancel?: () => void } | null = null;

    const frameId = requestAnimationFrame(() => {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        if (isCancelled) return;

        const warmupStartedAtMs = markStartup("startup-warmup-start");
        const prefetches: Promise<unknown>[] = [];

        const tracePrefetch = <T,>(
          label: string,
          queryKey: QueryKey,
          queryFn: () => Promise<T>,
        ) => {
          const before = getWarmQueryState(queryKey);
          logStartupEvent(`warmup ${label} begin`, before);

          return queryClient
            .prefetchQuery({
              queryKey,
              queryFn,
              meta: { persist: true },
            })
            .then(() => {
              const after = getWarmQueryState(queryKey);
              logStartupEvent(`warmup ${label} complete`, {
                beforeCacheState: before.cacheState,
                beforeIsStale: before.isStale,
                afterCacheState: after.cacheState,
                afterIsStale: after.isStale,
                fetched: before.dataUpdatedAt !== after.dataUpdatedAt,
              });
            });
        };

        if (activeLibraryId) {
          prefetches.push(
            tracePrefetch("library books", queryKeys.libraryBooks(activeLibraryId), () =>
              libraryItemsApi.getItems({ libraryId: activeLibraryId }),
            ),
          );
        }

        if (activeLibraryUserKey) {
          prefetches.push(
            tracePrefetch(
              "user server state",
              queryKeys.userServerState(activeLibraryUserKey),
              () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
            ),
          );
        }

        if (!prefetches.length) {
          logStartupEvent("warmup skipped", {
            reason: "missing-library-context",
            hasActiveLibraryId: Boolean(activeLibraryId),
            hasActiveLibraryUserKey: Boolean(activeLibraryUserKey),
          });
          return;
        }

        logStartupEvent("warmup start", {
          activeLibraryId,
          hasActiveLibraryUserKey: Boolean(activeLibraryUserKey),
        });

        Promise.all(prefetches)
          .then(() => {
            logStartupDuration("warmup complete", warmupStartedAtMs, {
              queryCount: prefetches.length,
            });
          })
          .catch((error) => {
            logStartupDuration("warmup failed", warmupStartedAtMs, {
              queryCount: prefetches.length,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
    });

    return () => {
      isCancelled = true;
      cancelAnimationFrame(frameId);
      interactionTask?.cancel?.();
    };
  }, [activeLibraryId, activeLibraryUserKey, status, warmupEligible]);

  const content = !renderReady ? (
    <View className="flex-1 items-center justify-center bg-bg">
      <ActivityIndicator size="large" color={themeColors.accent} />
    </View>
  ) : (
    <View style={{ flex: 1 }} onLayout={handleAppTreeLayout}>
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
                  // sheetAllowedDetents: [0.65],
                  sheetAllowedDetents: [0.5, 0.9],
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
                  sheetAllowedDetents: [0.45, 0.9],
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
                  sheetAllowedDetents: [0.45, 0.9],
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
                  sheetAllowedDetents: [0.45, 0.9],
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
                  sheetAllowedDetents: [0.45, 0.9],
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
                  sheetAllowedDetents: [0.45, 0.9],
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
                  presentation: "fullScreenModal",
                  animation: "slide_from_bottom",
                  gestureEnabled: false,
                  sheetGrabberVisible: false,
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                  },
                }}
              />
              <Stack.Screen
                name="book-addbookmark"
                options={{
                  headerShown: false,
                  presentation: "fullScreenModal",
                  animation: "slide_from_bottom",
                  gestureEnabled: false,
                  sheetGrabberVisible: false,
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
    </View>
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={handleQueryRestoreSuccess}
      onError={handleQueryRestoreError}
    >
      {content}
    </PersistQueryClientProvider>
  );
}
