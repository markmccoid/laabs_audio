import { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useSegments } from "expo-router";
import { useAuthActions, useAuthStore } from "../auth/auth-store";
import { useExplicitLogout } from "../auth/use-explicit-logout";
import { useLibraryActivationStore } from "../auth/library-activation-store";
import { useActivateLibrarySelection } from "../hooks/use-activate-library-selection";
import { useLibrarySelection } from "../hooks/use-library-selection";

// A stable key to scope library prompts/selections per user + server.
const getUserKey = (username: string | null, serverUrl: string | null) => {
  if (!username || !serverUrl) return null;
  return `${username}::${serverUrl}`;
};

export const LibrarySelectionGate = () => {
  // Auth + selection state needed to decide whether to auto-select or prompt.
  const status = useAuthStore((state) => state.status);
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const { clearActiveLibrary } = useAuthActions();
  const logout = useExplicitLogout();
  const activationStatus = useLibraryActivationStore((state) => state.status);
  const activateLibrarySelection = useActivateLibrarySelection();
  const segments = useSegments();

  // Query + actions for fetching and storing library selection.
  const { libraries, isLoading, isFetching, isFetched, isError, refetch, selectLibrary } =
    useLibrarySelection();

  const userKey = useMemo(
    () => getUserKey(storedUsername, serverUrl),
    [serverUrl, storedUsername],
  );

  // Track whether we've prompted or requested for the current user key.
  const promptRef = useRef<string | null>(null);
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset prompt/request guards whenever auth resets or user changes.
    if (status !== "authenticated") {
      promptRef.current = null;
      requestedRef.current = null;
      return;
    }

    if (userKey && requestedRef.current && requestedRef.current !== userKey) {
      promptRef.current = null;
      requestedRef.current = null;
    }
  }, [status, userKey]);

  useEffect(() => {
    // Fetch libraries once per user when authenticated. This validates persisted Library data.
    if (status !== "authenticated") return;
    if (loginRequired) return;
    if (!userKey) return;
    if (isLoading || isFetching) return;
    if (requestedRef.current === userKey) return;

    requestedRef.current = userKey;
    refetch();
  }, [isFetching, isLoading, loginRequired, refetch, status, userKey]);

  useEffect(() => {
    // Validate or resolve the Active Library after Libraries are known.
    if (status !== "authenticated") return;
    if (loginRequired) return;
    if (!isFetched) return;
    if (isFetching) return;
    if (activationStatus !== "idle") return;
    if (!libraries.length) {
      if (activeLibraryId) {
        clearActiveLibrary();
      }
      return;
    }

    const rootSegment = segments[0];
    const canOpenPicker = rootSegment !== "library-picker" && rootSegment !== "login";
    const active = libraries.find((library) => library.id === activeLibraryId);
    if (active) {
      // Backfill missing display name if we have a valid ID.
      if (!activeLibraryName) {
        selectLibrary(active);
      }
      return;
    }

    if (activeLibraryId) {
      clearActiveLibrary();
    }

    if (libraries.length === 1) {
      void activateLibrarySelection(libraries[0], { mode: "setup" });
      return;
    }

    if (!canOpenPicker) return;
    if (promptRef.current === userKey) return;

    // Multiple Libraries require explicit Library Selection before setting Active Library.
    router.push("/library-picker");
    promptRef.current = userKey;
  }, [
    activeLibraryId,
    activeLibraryName,
    activateLibrarySelection,
    activationStatus,
    clearActiveLibrary,
    isFetched,
    isFetching,
    libraries,
    loginRequired,
    segments,
    selectLibrary,
    status,
    userKey,
  ]);

  if (status !== "authenticated" || loginRequired) return null;
  if (
    isFetched &&
    !isLoading &&
    !isFetching &&
    !isError &&
    !activeLibraryId &&
    libraries.length === 0
  ) {
    return (
      <View className="absolute inset-0 z-50 items-center justify-center bg-bg px-6">
        <View className="w-full max-w-md rounded-2xl border border-border bg-surface px-5 py-5">
          <Text className="text-xl font-semibold text-text">No libraries available</Text>
          <Text className="mt-2 text-sm leading-5 text-text-muted">
            This Audiobookshelf user is signed in, but the server did not return any libraries.
          </Text>
          <View className="mt-5 flex-row gap-3">
            <Pressable onPress={() => refetch()} className="rounded-full bg-accent px-4 py-2">
              <Text className="text-sm font-semibold text-accent-foreground">Retry</Text>
            </Pressable>
            <Pressable onPress={() => logout()} className="rounded-full bg-bg px-4 py-2">
              <Text className="text-sm font-semibold text-text-muted">Log out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!isError || activeLibraryId) return null;

  // Non-blocking retry banner when libraries failed to load and none is selected.
  return (
    <View className="absolute bottom-6 left-6 right-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <Text className="text-sm font-semibold text-amber-900">
        Unable to load libraries
      </Text>
      <Text className="mt-1 text-xs text-amber-800">
        {isLoading
          ? "Trying again..."
          : "Connect to the internet and retry."}
      </Text>
      <Pressable
        onPress={() => refetch()}
        className="mt-3 self-start rounded-full bg-amber-900 px-3 py-1"
      >
        <Text className="text-xs font-semibold text-white">Retry</Text>
      </Pressable>
    </View>
  );
};
