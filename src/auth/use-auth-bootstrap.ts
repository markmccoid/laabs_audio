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
import { recordProgressSyncIntent } from "../progress/progress-sync-intent-store";
import { recordEpisodeProgressSyncIntent } from "../podcast/episode-progress-intent-store";
import {
  resolveBackgroundProgressIntent,
  routeBackgroundProgressIntent,
} from "../progress/background-progress-routing";
import { syncPendingEpisodeProgressIntents } from "../podcast/episode-progress-sync-service";

export const useAuthBootstrap = () => {
  const status = useAuthStore((state) => state.status);
  const isOnline = useAuthStore((state) => state.isOnline);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const storedUserId = useAuthStore((state) => state.storedUserId);
  const resolvedUserKey = activeLibraryUserKey ?? storedUserId;
  const hasOfflineContent = useDeviceBooksStore((state) =>
    selectHasOfflineContent(state, resolvedUserKey),
  );
  const {
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
      const intent = resolveBackgroundProgressIntent({
        playback: playbackState,
        userKey: resolvedUserKey,
        libraryId: activeLibraryId,
      });
      if (!intent) return;
      routeBackgroundProgressIntent(intent, {
        recordBook: recordProgressSyncIntent,
        recordEpisode: recordEpisodeProgressSyncIntent,
      });
    });

    return () => subscription.remove();
  }, [activeLibraryId, resolvedUserKey]);

  useEffect(() => {
    if (!isOnline) return;
    if (status !== "authenticated") return;
    const syncPending = async () => {
      await syncPendingProgress().catch(() => undefined);
      if (resolvedUserKey) {
        await syncPendingEpisodeProgressIntents({ userKey: resolvedUserKey }).catch(
          () => undefined,
        );
      }
      await syncPendingBookmarkDeletes().catch(() => undefined);
      await syncPendingBookmarks().catch(() => undefined);
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
    resolvedUserKey,
  ]);

  return { status };
};
