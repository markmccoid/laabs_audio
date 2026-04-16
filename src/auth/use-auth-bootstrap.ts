import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { useAuthActions, useAuthStore } from "./auth-store";
import {
  selectHasOfflineContent,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "../store/device-books-store";
import { playbackStore } from "../player/playback-store";

const MIN_BACKGROUND_PROGRESS_SECONDS_TO_QUEUE = 1;

export const useAuthBootstrap = () => {
  const status = useAuthStore((state) => state.status);
  const isOnline = useAuthStore((state) => state.isOnline);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const resolvedUserKey =
    activeLibraryUserKey ??
    (storedUsername && serverUrl ? `${storedUsername}::${serverUrl}` : null);
  const hasOfflineContent = useDeviceBooksStore((state) =>
    selectHasOfflineContent(state, resolvedUserKey),
  );
  const {
    queueProgressSync,
    syncPendingProgress,
    syncPendingBookmarks,
    syncPendingBookmarkDeletes,
    syncPendingPlaylistOps,
  } = useDeviceBooksActions();
  const {
    hydrateFromStorage,
    setOnlineStatus,
    setHasOfflineContent,
    refreshSession,
  } = useAuthActions();

  useEffect(() => {
    if (!__DEV__) return;
    console.log("[auth-bootstrap]", {
      status,
      isOnline,
      hasOfflineContent,
      hasRefreshToken: Boolean(refreshToken),
      resolvedUserKey,
    });
  }, [hasOfflineContent, isOnline, refreshToken, resolvedUserKey, status]);

  useEffect(() => {
    hydrateFromStorage(hasOfflineContent).catch(() => undefined);
  }, [hasOfflineContent, hydrateFromStorage]);

  useEffect(() => {
    setHasOfflineContent(hasOfflineContent);
  }, [hasOfflineContent, setHasOfflineContent]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected ?? true;
      setOnlineStatus(online);
    });

    return () => unsubscribe();
  }, [setOnlineStatus]);

  useEffect(() => {
    if (status === "hydrating") return;
    if (!refreshToken) return;
    if (isOnline) {
      refreshSession().catch(() => undefined);
    }
  }, [isOnline, refreshSession, refreshToken, status]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") return;

      const playbackState = playbackStore.getState();
      if (!playbackState.libraryItemId) return;
      if (!playbackState.queue.length) return;
      const isPlayableState =
        playbackState.playbackState === "playing" || playbackState.playbackState === "paused";
      if (!isPlayableState) return;

      const currentTime = Math.max(0, Math.floor(playbackState.positionMs / 1000));
      const isFinished =
        playbackState.durationMs > 0 && playbackState.positionMs >= playbackState.durationMs - 3000;
      if (currentTime < MIN_BACKGROUND_PROGRESS_SECONDS_TO_QUEUE && !isFinished) return;

      queueProgressSync(playbackState.libraryItemId, {
        currentTime,
        isFinished,
      }, {
        title: playbackState.bookTitle,
        sessionKind: playbackState.sessionId === "local" ? "downloaded" : "streamed",
        trigger: "background_app_state",
      });
    });

    return () => subscription.remove();
  }, [queueProgressSync]);

  useEffect(() => {
    if (!isOnline) return;
    if (status !== "authenticated") return;
    const syncPending = async () => {
      await syncPendingProgress().catch(() => undefined);
      await syncPendingBookmarks().catch(() => undefined);
      await syncPendingBookmarkDeletes().catch(() => undefined);
      await syncPendingPlaylistOps().catch(() => undefined);
    };
    syncPending().catch(() => undefined);
  }, [
    isOnline,
    status,
    syncPendingBookmarkDeletes,
    syncPendingBookmarks,
    syncPendingPlaylistOps,
    syncPendingProgress,
  ]);

  return { status };
};
