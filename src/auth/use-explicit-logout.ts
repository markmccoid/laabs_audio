import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { playerService } from "../player/player-service";
import { queryClient } from "../query/query-client";
import { clearSessionQueryCache } from "../query/session-query-cache";
import { libraryActivationStore } from "./library-activation-store";
import { useAuthActions } from "./auth-store";

export const useExplicitLogout = () => {
  const { logout } = useAuthActions();
  const isLoggingOutRef = useRef(false);

  return useCallback(async () => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    try {
      await playerService.endActivePlaybackForLogout().catch((error) => {
        if (__DEV__) {
          console.warn("[explicit-logout] player-teardown-failed", { error });
        }
      });
      libraryActivationStore.getState().actions.clear();
      clearSessionQueryCache(queryClient);
      await logout();
      router.replace({ pathname: "/login", params: { mode: "required" } });
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [logout]);
};
