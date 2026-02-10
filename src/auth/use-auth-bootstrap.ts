import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useAuthActions, useAuthStore } from "./auth-store";
import { selectHasOfflineContent, useBooksStore } from "../store/store-books";

export const useAuthBootstrap = () => {
  const status = useAuthStore((state) => state.status);
  const isOnline = useAuthStore((state) => state.isOnline);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const hasOfflineContent = useBooksStore(selectHasOfflineContent);
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

  return { status };
};
