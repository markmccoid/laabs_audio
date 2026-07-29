import type { QueryKey } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as Linking from "expo-linking";
import {
  Stack,
  router,
  useGlobalSearchParams,
  useSegments,
  type NativeStackNavigationOptions,
} from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, InteractionManager, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Toaster } from "react-native-sonner";
import { Uniwind } from "uniwind";
import { AmbientCoordinator } from "../ambient/ambient-coordinator";
import { selectAccessMode, useAuthStore } from "../auth/auth-store";
import { CarPlayShelfPublisher } from "../carplay/carplay-shelf-publisher";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import { ActiveDownloadToastCoordinator } from "../components/bookComponents/active-download-toast-coordinator";
import { useSqliteActiveLibraryRefresh } from "../data/sqlite/use-sqlite-active-library-refresh";
import { LibraryActivationOverlay } from "../components/library-activation-overlay";
import { LibrarySelectionGate } from "../components/library-selection-gate";
import { OfflineConnectionBanner } from "../components/offline-connection-banner";
import "../global.css";
import { extractBookDetailIdFromUrl } from "../navigation/book-links";
import {
  getAuthenticatedRouteState,
  isKnownAuthenticatedRoute,
} from "../navigation/authenticated-route-state";
import { playerService } from "../player/player-service";
import { playbackStore, usePlaybackStore } from "../player/playback-store";
import { settingsStore } from "../store/settings-store";
import { SleepTimerCoordinator } from "../player/sleep-timer-coordinator";
import { FIVE_MINUTES_MS, queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { clearSessionQueryCache } from "../query/session-query-cache";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import {
  getPersistedQueryCacheSizeBytes,
  mmkvQueryPersister,
} from "../store/mmkv-query-persister";
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

// Recover the viewed book id when the router is already sitting on the Home detail route.
const getReturnToLibraryItemId = (
  segments: string[],
  globalParams: { libraryItemId?: string | string[] },
) =>
  segments[0] === "(tabs)" && segments[1] === "(home)" && segments[2] === "[libraryItemId]"
    ? resolveParam(globalParams.libraryItemId)
    : undefined;

const isDownloadedAccessMode = (accessMode: string) =>
  accessMode === "downloadedOnly" || accessMode === "downloadedSessionOnly";

const isActivePlaybackState = (playbackState: string) =>
  playbackState === "loading" ||
  playbackState === "ready" ||
  playbackState === "playing" ||
  playbackState === "paused";

// A cold launch hydrates the playback store to a non-active state; only then is it
// safe to restore the last book without clobbering live playback.
const isRestorableIdlePlaybackState = (playbackState: string) =>
  playbackState === "idle" || playbackState === "ended";

// Shared presentation for the utility bottom sheets pushed over the root stack.
// Pass overrides for per-sheet detents, headers, or content styling.
const sheetScreenOptions = (
  backgroundColor: string,
  overrides: NativeStackNavigationOptions = {},
): NativeStackNavigationOptions => ({
  presentation: "formSheet",
  animation: "slide_from_bottom",
  sheetAllowedDetents: [0.45, 0.9],
  sheetGrabberVisible: true,
  sheetCornerRadius: 20,
  contentStyle: { backgroundColor },
  ...overrides,
});

export default function RootLayout() {
  useApplyAccentThemeOverrides();
  useSqliteActiveLibraryRefresh();
  const { status } = useAuthBootstrap();
  const navigationTheme = useNavigationTheme();
  const themeColors = useThemeColors();
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const accessMode = useAuthStore(selectAccessMode);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const rememberedSessionCount = useAuthStore((state) => state.rememberedSessions.length);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const playbackQueueLength = usePlaybackStore((state) => state.queue.length);
  const playbackControlIntent = usePlaybackStore((state) => state.playbackControlIntent);
  const segments = useSegments();
  const globalParams = useGlobalSearchParams<{ libraryItemId?: string | string[] }>();
  const previousStatus = useRef<typeof status | null>(null);
  const didDecideStartupRestoreRef = useRef(false);
  const [queryRestoreStartedAtMs] = useState(() => markStartup("query-restore-start"));
  const initialUrlStartedAtMsRef = useRef<number | null>(null);
  const splashHiddenRef = useRef(false);
  const [initialDeepLinkBookId, setInitialDeepLinkBookId] = useState<string | null | undefined>(
    undefined,
  );
  const [hasPresentedInitialContent, setHasPresentedInitialContent] = useState(
    () => getStartupPresentationState().hasPresentedInitialContent,
  );
  const [queryRestoreReady, setQueryRestoreReady] = useState(false);
  const routeState = useMemo(() => getAuthenticatedRouteState(segments), [segments]);
  const returnToLibraryItemId = useMemo(
    () => getReturnToLibraryItemId(segments, globalParams),
    [globalParams, segments],
  );
  const startupBookLinkId = returnToLibraryItemId ?? initialDeepLinkBookId ?? undefined;
  const hasActivePlayback = Boolean(
    playbackLibraryItemId &&
      isActivePlaybackState(playbackState) &&
      (playbackQueueLength > 0 || playbackState === "loading" || playbackControlIntent),
  );
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
    logStartupDuration("query restore complete", queryRestoreStartedAtMs, {
      restoredQueryCount: queryClient.getQueryCache().getAll().length,
      persistedCacheBytes: getPersistedQueryCacheSizeBytes(),
    });
  }, [queryRestoreStartedAtMs]);

  const handleQueryRestoreError = useCallback(() => {
    logStartupDebug("queryRestore:error", {
      queryCount: queryClient.getQueryCache().getAll().length,
    });
    setQueryRestoreReady(true);
    logStartupDuration("query restore failed", queryRestoreStartedAtMs, {
      restoredQueryCount: queryClient.getQueryCache().getAll().length,
      persistedCacheBytes: getPersistedQueryCacheSizeBytes(),
    });
  }, [queryRestoreStartedAtMs]);

  // Persist only queries that opt-in via `meta.persist`
  const persistOptions = useMemo(
    () => ({
      persister: mmkvQueryPersister,
      maxAge: Infinity,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: {
          meta?: Record<string, unknown>;
          state?: { status?: string };
        }) => query.meta?.persist === true && query.state?.status === "success",
      },
    }),
    [],
  );

  useEffect(() => {
    Uniwind.setTheme("system");
  }, []);

  useEffect(() => {
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
    initialUrlStartedAtMsRef.current = markStartup("initial-url-start");

    Linking.getInitialURL()
      .then((initialUrl) => {
        didResolveInitialUrl = true;
        clearTimeout(unresolvedUrlTimer);
        if (!isMounted) return;
        logStartupDebug("initialUrl:resolved", {
          initialUrl,
          extractedLibraryItemId: extractBookDetailIdFromUrl(initialUrl) ?? null,
        });
        logStartupDuration("initial URL resolved", initialUrlStartedAtMsRef.current, {
          hasInitialUrl: Boolean(initialUrl),
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
        logStartupDuration("initial URL failed", initialUrlStartedAtMsRef.current, {
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
    const task = InteractionManager.runAfterInteractions(() => {
      setInitialDeepLinkBookId(null);
    });
    return () => task.cancel();
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
      accessMode,
      loginRequired,
      routeState,
      startupBookLinkId,
      initialDeepLinkBookId,
    });

    // Keep all auth and startup routing decisions in one place to avoid competing redirects.
    if (
      accessMode === "firstRunSignInRequired" &&
      !hasActivePlayback &&
      !routeState.inLogin
    ) {
      logStartupDebug("routeGate:redirect-login-required", {
        startupBookLinkId,
      });
      router.replace({
        pathname: rememberedSessionCount > 0 ? "/login" : "/login/add",
        params: {
          mode: "required",
          returnToLibraryItemId: startupBookLinkId,
        },
      } as never);
      return;
    }

    if (
      loginRequired &&
      !hasActivePlayback &&
      accessMode !== "firstRunSignInRequired" &&
      accessMode !== "downloadedSessionOnly" &&
      !routeState.inLogin
    ) {
      logStartupDebug("routeGate:push-login-sheet");
      router.push({ pathname: "/login", params: { mode: "sheet" } });
      return;
    }

    if (isDownloadedAccessMode(accessMode) && routeState.inLibraryPicker) {
      logStartupDebug("routeGate:redirect-downloaded-access-home");
      router.replace("/(tabs)/(home)");
      return;
    }

    const isKnownRoute = isKnownAuthenticatedRoute(routeState);

    if (accessMode !== "firstRunSignInRequired" && !isKnownRoute) {
      if (startupBookLinkId) {
        logStartupDebug("routeGate:holding-for-deeplink", {
          startupBookLinkId,
        });
        return;
      }
      logStartupDebug("routeGate:redirect-home");
      router.replace("/(tabs)/(home)");
    }
  }, [
    accessMode,
    hasActivePlayback,
    initialDeepLinkBookId,
    loginRequired,
    rememberedSessionCount,
    routeState,
    startupBookLinkId,
    status,
  ]);

  useEffect(() => {
    if (status === "hydrating") return;

    const prevStatus = previousStatus.current;

    // Clear persisted query data on logout transitions.
    const didLogout = prevStatus !== null && prevStatus !== "anonymous" && status === "anonymous";
    if (didLogout) {
      void clearSessionQueryCache(queryClient);
    }

    // Track current values for the next transition check.
    previousStatus.current = status;
  }, [status]);

  useEffect(() => {
    playerService.init();
  }, []);

  // Startup Active Playback Restore: once startup has settled (auth resolved, query cache
  // restored, first content presented), bring the most recent book back as a loaded, paused
  // Active Playback. Decide exactly once per launch and never auto-play. Best-effort: a
  // failed load (offline / Session Needs Sign-In / streamed session failure) leaves the
  // player idle and preserves the saved book for a later launch.
  useEffect(() => {
    if (didDecideStartupRestoreRef.current) return;
    if (!warmupEligible) return;
    didDecideStartupRestoreRef.current = true;

    // No usable session to load a book into yet.
    if (accessMode === "firstRunSignInRequired") return;
    // A deep link / return-to-book flow owns startup playback; don't compete with it.
    if (startupBookLinkId) return;
    if (!settingsStore.getState().restoreLastBookOnStartup) return;

    const state = playbackStore.getState();
    if (!state.libraryItemId) return;
    if (state.queue.length > 0 || state.playbackControlIntent) return;
    if (!isRestorableIdlePlaybackState(state.playbackState)) return;

    const restoreLibraryItemId = state.libraryItemId;
    const restoreEpisodeId = state.episodeId;
    logStartupEvent("startup restore begin", {
      libraryItemId: restoreLibraryItemId,
      episodeId: restoreEpisodeId,
    });
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      const restorePromise = restoreEpisodeId
        ? playerService.loadEpisode(restoreLibraryItemId, restoreEpisodeId, {
            autoPlay: false,
            suppressErrorState: true,
            episodeTitle: state.bookTitle,
            podcastTitle: state.secondaryTitle,
          })
        : playerService.loadBook(restoreLibraryItemId, {
            autoPlay: false,
            suppressErrorState: true,
          });
      void restorePromise
        .then(() => logStartupEvent("startup restore complete"))
        .catch(() => logStartupEvent("startup restore failed"));
    });

    return () => interactionTask.cancel?.();
  }, [accessMode, startupBookLinkId, warmupEligible]);

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
          <CarPlayShelfPublisher />
          <LibraryActivationOverlay />
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
                  presentation: "card",
                  animation: "slide_from_right",
                  contentStyle: {
                    backgroundColor: themeColors.bg,
                  },
                }}
              />
              <Stack.Screen
                name="library-picker"
                options={sheetScreenOptions(themeColors.surface, {
                  sheetAllowedDetents: [0.5, 0.9],
                })}
              />
              <Stack.Screen
                name="chapter-viewer"
                options={sheetScreenOptions(themeColors.surface, {
                  sheetAllowedDetents: [0.5, 0.9],
                })}
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
                options={sheetScreenOptions(themeColors.surface, {
                  sheetAllowedDetents: [0.5, 0.9],
                })}
              />
              <Stack.Screen
                name="player-bookmarks"
                options={sheetScreenOptions(themeColors.surface, {
                  contentStyle: {
                    backgroundColor: themeColors.surface,
                    height: "100%",
                  },
                })}
              />
              <Stack.Screen
                name="player-sleep-timer"
                options={sheetScreenOptions(themeColors.surface)}
              />
              <Stack.Screen
                name="player-ambient"
                options={sheetScreenOptions(themeColors.surface)}
              />
              <Stack.Screen
                name="book-bookshelves"
                options={sheetScreenOptions(themeColors.surface, {
                  headerTitle: "Add To Bookshelf",
                  headerShown: true,
                })}
              />
              <Stack.Screen
                name="book-downloads"
                options={sheetScreenOptions(themeColors.surface)}
              />
              <Stack.Screen
                name="episode-downloads"
                options={sheetScreenOptions(themeColors.surface)}
              />
              <Stack.Screen
                name="episode-bookmarks"
                options={sheetScreenOptions(themeColors.surface, {
                  headerShown: false,
                  gestureEnabled: true,
                })}
              />
              <Stack.Screen
                name="episode-bookmark-detail"
                options={{
                  headerShown: false,
                  presentation: "fullScreenModal",
                  animation: "slide_from_bottom",
                  gestureEnabled: false,
                  sheetGrabberVisible: false,
                  contentStyle: { backgroundColor: themeColors.surface },
                }}
              />
              <Stack.Screen
                name="episode-addbookmark"
                options={{
                  headerShown: false,
                  presentation: "fullScreenModal",
                  animation: "slide_from_bottom",
                  gestureEnabled: false,
                  sheetGrabberVisible: false,
                  contentStyle: { backgroundColor: themeColors.surface },
                }}
              />
              <Stack.Screen
                name="book-bookmarks"
                options={sheetScreenOptions(themeColors.surface, {
                  headerShown: false,
                  gestureEnabled: true,
                })}
              />
              <Stack.Screen
                name="book-bookmark-detail"
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
                options={sheetScreenOptions(themeColors.surface, {
                  headerShown: true,
                  sheetAllowedDetents: [0.45, 0.95],
                })}
              />
              <Stack.Screen
                name="book-filter-results"
                options={sheetScreenOptions(themeColors.surface, {
                  headerShown: true,
                  sheetAllowedDetents: [0.95],
                })}
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
