import { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useSegments } from "expo-router";
import { useAuthStore } from "../auth/auth-store";
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
  const segments = useSegments();

  // Query + actions for fetching and storing library selection.
  const { libraries, isLoading, isError, refetch, selectLibrary } = useLibrarySelection();

  const userKey = useMemo(
    () => getUserKey(storedUsername, serverUrl),
    [serverUrl, storedUsername],
  );

  // Track whether we've prompted or requested for the current user key.
  const promptRef = useRef<string | null>(null);
  const requestedRef = useRef<string | null>(null);
  const previousUserKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset prompt/request guards whenever auth resets or user changes.
    if (status !== "authenticated") {
      promptRef.current = null;
      requestedRef.current = null;
      previousUserKeyRef.current = null;
      return;
    }

    if (userKey && previousUserKeyRef.current && previousUserKeyRef.current !== userKey) {
      promptRef.current = null;
      requestedRef.current = null;
    }

    previousUserKeyRef.current = userKey;
  }, [status, userKey]);

  useEffect(() => {
    // Fetch libraries once per user when authenticated and not already loaded.
    if (status !== "authenticated") return;
    if (loginRequired) return;
    if (!userKey) return;
    if (libraries.length > 0) return;
    if (isLoading) return;
    if (requestedRef.current === userKey) return;

    requestedRef.current = userKey;
    refetch();
  }, [isLoading, libraries.length, loginRequired, refetch, status, userKey]);

  useEffect(() => {
    // Ensure an active library exists, and prompt for selection if needed.
    if (status !== "authenticated") return;
    if (loginRequired) return;
    if (!libraries.length) return;

    const active = libraries.find((library) => library.id === activeLibraryId);
    if (!active) {
      // Default to the first library if none is selected or it no longer exists.
      selectLibrary(libraries[0]);
    } else if (!activeLibraryName) {
      // Backfill missing display name if we have a valid ID.
      selectLibrary(active);
    }

    if (libraries.length <= 1) {
      // Nothing to pick from, so mark prompt as satisfied.
      promptRef.current = userKey;
      return;
    }

    if (promptRef.current === userKey) return;

    const rootSegment = segments[0];
    if (rootSegment === "library-picker") return;
    if (rootSegment === "login") return;

    // Open the picker sheet for multi-library accounts.
    router.push("/library-picker");
    promptRef.current = userKey;
  }, [
    activeLibraryId,
    activeLibraryName,
    libraries,
    loginRequired,
    segments,
    selectLibrary,
    status,
    userKey,
  ]);

  if (status !== "authenticated" || loginRequired) return null;
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
