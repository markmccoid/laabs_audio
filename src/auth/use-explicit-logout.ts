import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { authStore, selectAccessMode, useAuthActions } from "./auth-store";
import { prepareForUserSessionBoundary } from "./session-boundary";

export const useExplicitLogout = () => {
  const { logout } = useAuthActions();
  const isLoggingOutRef = useRef(false);

  // `stayInSignIns` leaves navigation to a caller already on the Sign-Ins screens, so the user
  // can pick another sign-in instead of being sent away.
  return useCallback(async (options: { stayInSignIns?: boolean } = {}) => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    try {
      await prepareForUserSessionBoundary();
      await logout();
      if (options.stayInSignIns) return;
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
