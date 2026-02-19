import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useAuthActions, useAuthStore } from "./auth-store";
import {
  selectHasOfflineContent,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "../store/device-books-store";

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
  const { syncPendingBookmarks, syncPendingBookmarkDeletes } = useDeviceBooksActions();
  const {
    hydrateFromStorage,
    setOnlineStatus,
    setHasOfflineContent,
    refreshSession,
  } = useAuthActions();

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
    if (!isOnline) return;
    if (status !== "authenticated") return;
    syncPendingBookmarks().catch(() => undefined);
    syncPendingBookmarkDeletes().catch(() => undefined);
  }, [isOnline, status, syncPendingBookmarkDeletes, syncPendingBookmarks]);

  return { status };
};
