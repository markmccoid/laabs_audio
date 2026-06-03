import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { useAuthActions } from "./auth-store";
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
      router.replace({ pathname: "/login", params: { mode: "required" } });
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [logout]);
};
