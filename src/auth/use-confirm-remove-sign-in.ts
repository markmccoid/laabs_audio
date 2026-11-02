import type { RememberedSessionRecord } from "./auth-storage";
import { useAuthActions, useAuthStore } from "./auth-store";
import { useExplicitLogout } from "./use-explicit-logout";
import { useCallback } from "react";
import { Alert } from "react-native";

type ConfirmRemoveOptions = {
  onPendingChange?: (pending: boolean) => void;
  onRemoved?: () => void;
};

/** Asks before removing a remembered sign-in, signing out first when it is the active one. */
export const useConfirmRemoveSignIn = () => {
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const { removeRememberedSession } = useAuthActions();
  const explicitLogout = useExplicitLogout();

  return useCallback(
    (session: RememberedSessionRecord, options: ConfirmRemoveOptions = {}) => {
      const isActive = session.key === activeSessionKey;
      Alert.alert(
        "Remove Sign-In?",
        `Remove ${session.label}? Downloaded audio and listening data stay on this device.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              void (async () => {
                options.onPendingChange?.(true);
                try {
                  if (isActive) {
                    await explicitLogout({ stayInSignIns: true });
                  }
                  await removeRememberedSession(session.key);
                  options.onRemoved?.();
                } finally {
                  options.onPendingChange?.(false);
                }
              })();
            },
          },
        ],
      );
    },
    [activeSessionKey, explicitLogout, removeRememberedSession],
  );
};
