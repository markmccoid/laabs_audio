import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, router, useSegments } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "../auth/auth-store";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import "../global.css";
import { playerService } from "../player/player-service";
import { mmkvQueryPersister } from "../store/mmkv-query-persister";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 60 * 1000,
    },
  },
});

export default function RootLayout() {
  const { status } = useAuthBootstrap();
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore(
    (state) => state.activeLibraryUserKey,
  );
  const segments = useSegments();
  const previousStatus = useRef<typeof status | null>(null);
  const previousLibraryId = useRef<string | null>(null);

  // Persist only queries that opt-in via `meta.persist`
  const persistOptions = useMemo(
    () => ({
      persister: mmkvQueryPersister,
      maxAge: 1000 * 60 * 60 * 24, // 24h persistence window
      // Bust cache when user/server changes to avoid cross-account data
      buster: activeLibraryUserKey ?? "anon",
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => query.meta?.persist === true,
      },
    }),
    [activeLibraryUserKey],
  );

  useEffect(() => {
    if (status === "hydrating") return;

    const rootSegment = segments[0];
    const inLogin = rootSegment === "login";
    const inTabs = rootSegment === "(tabs)";
    const inLibraryPicker = rootSegment === "library-picker";
    if (status === "anonymous" && !inLogin) {
      router.replace({ pathname: "/login", params: { mode: "required" } });
      return;
    }

    if (status !== "anonymous" && !loginRequired && !inTabs && !inLibraryPicker) {
      router.replace("/(tabs)/(home)");
    }
  }, [loginRequired, segments, status]);

  useEffect(() => {
    if (status === "hydrating") return;

    const prevStatus = previousStatus.current;
    const prevLibraryId = previousLibraryId.current;

    // Clear persisted query data on logout transitions
    const didLogout = prevStatus !== null && prevStatus !== "anonymous" && status === "anonymous";
    if (didLogout) {
      mmkvQueryPersister.removeClient();
      queryClient.clear();
    }

    // Clear persisted query data when switching libraries
    const didSwitchLibrary =
      Boolean(prevLibraryId) &&
      Boolean(activeLibraryId) &&
      prevLibraryId !== activeLibraryId;
    if (didSwitchLibrary) {
      mmkvQueryPersister.removeClient();
      queryClient.clear();
    }

    // Track current values for the next transition check
    previousStatus.current = status;
    previousLibraryId.current = activeLibraryId ?? null;
  }, [activeLibraryId, status]);

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

  if (status === "hydrating") {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      {/* <LibrarySelectionGate /> */}
      <Stack screenOptions={{ headerShown: false }}>
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
              backgroundColor: "white",
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
              backgroundColor: "white",
            },
          }}
        />
      </Stack>
    </PersistQueryClientProvider>
  );
}
