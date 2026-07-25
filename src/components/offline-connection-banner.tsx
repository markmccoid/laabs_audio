import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { librariesApi } from "../api/libraries-api";
import { useActiveLibraryExperience } from "../auth/active-library-experience";
import { useAuthActions, useAuthStore } from "../auth/auth-store";
import { sqliteRefreshCoordinator } from "../data/sqlite/refresh-coordinator";
import { queryKeys } from "../query/query-keys";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import { useThemeColors } from "../theme/use-app-theme";

export const OfflineConnectionBanner = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const segments = useSegments();
  const rootSegment = segments[0];
  const isOnline = useAuthStore((state) => state.isOnline);
  const serverConnectionStatus = useAuthStore((state) => state.serverConnectionStatus);
  const status = useAuthStore((state) => state.status);
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryExperience = useActiveLibraryExperience();
  const { refreshSession, setOnlineStatus, setServerConnectionStatus } = useAuthActions();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    if (isRetrying) return;
    setIsRetrying(true);

    try {
      const networkState = await NetInfo.fetch();
      const online = networkState.isConnected ?? true;
      setOnlineStatus(online);

      if (!online) return;
      setServerConnectionStatus("unknown");
      if (status === "anonymous" || loginRequired) return;

      const refreshes: Promise<unknown>[] = [];

      refreshes.push(refreshSession({ force: true }).catch(() => undefined));

      if (activeLibraryUserKey) {
        refreshes.push(
          queryClient.fetchQuery({
            queryKey: queryKeys.libraries(activeLibraryUserKey),
            queryFn: () => librariesApi.getAll(),
            meta: { persist: true },
          }),
        );
      }

      if (
        activeLibraryExperience === "book" &&
        activeLibraryId &&
        activeLibraryUserKey
      ) {
        refreshes.push(
          sqliteRefreshCoordinator
            .refreshActiveLibrary(
              { userId: activeLibraryUserKey, libraryId: activeLibraryId },
              { queryClient },
            )
            .catch(() => undefined),
        );
      }

      if (activeLibraryUserKey) {
        refreshes.push(
          queryClient.fetchQuery({
            queryKey: queryKeys.userServerState(activeLibraryUserKey),
            queryFn: () => fetchReconciledUserServerState(queryClient, activeLibraryUserKey),
            meta: { persist: true },
          }),
        );
      }

      await Promise.allSettled(refreshes);
    } finally {
      setIsRetrying(false);
    }
  }, [
    activeLibraryId,
    activeLibraryExperience,
    activeLibraryUserKey,
    isRetrying,
    loginRequired,
    queryClient,
    refreshSession,
    setOnlineStatus,
    setServerConnectionStatus,
    status,
  ]);

  const isDeviceOffline = isOnline === false;
  const isServerUnavailable = isOnline !== false && serverConnectionStatus === "unreachable";
  if ((!isDeviceOffline && !isServerUnavailable) || rootSegment === "main-player") return null;

  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: themeColors.border,
        backgroundColor: themeColors.surface,
        paddingHorizontal: 16,
        paddingTop: Math.max(10, insets.top + 4),
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
        <SymbolView
          name={isDeviceOffline ? "wifi.slash" : "exclamationmark.triangle"}
          size={15}
          tintColor={themeColors.textMuted}
        />
        <Text numberOfLines={2} style={{ color: themeColors.textMuted, fontSize: 13, flexShrink: 1 }}>
          {isDeviceOffline
            ? "Device offline. Cached library only; downloaded audiobooks can play."
            : "Audiobookshelf unavailable. Cached library only; downloaded audiobooks can play."}
        </Text>
      </View>

      <Pressable
        onPress={() => {
          void handleRetry();
        }}
        disabled={isRetrying}
        accessibilityRole="button"
        accessibilityLabel="Retry connection"
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: themeColors.border,
          borderRadius: 999,
          borderCurve: "continuous",
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: themeColors.bg,
          opacity: isRetrying ? 0.6 : pressed ? 0.8 : 1,
        })}
      >
        <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: "600" }}>
          {isRetrying ? "Retrying..." : "Retry"}
        </Text>
      </Pressable>
    </View>
  );
};
