import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { authStore, selectAccessMode, useAuthActions } from "./auth-store";
import { prepareForUserSessionBoundary } from "./session-boundary";

export const useExplicitLogout = () => {
  const { logout } = useAuthActions();
  const isLoggingOutRef = useRef(false);

  return useCallback(async () => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    try {
      await prepareForUserSessionBoundary();
      await logout();
      // Downloaded-Only or Imported-Only Mode keeps the user in the app; otherwise Welcome Choice.
      if (selectAccessMode(authStore.getState()) === "firstRunSignInRequired") {
        router.replace("/login/welcome");
      } else {
        router.replace("/(tabs)/(home)");
      }
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [logout]);
};
