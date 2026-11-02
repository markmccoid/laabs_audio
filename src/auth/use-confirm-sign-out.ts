import type { RememberedSessionRecord } from "./auth-storage";
import { useExplicitLogout } from "./use-explicit-logout";
import { useCallback } from "react";
import { Alert } from "react-native";

/**
 * Asks before signing out of the active sign-in. The user stays on the Sign-Ins screens so
 * another sign-in can be picked; `onSignedOut` runs once the sign-out finishes.
 */
export const useConfirmSignOut = () => {
  const explicitLogout = useExplicitLogout();

  return useCallback(
    (session: RememberedSessionRecord, onSignedOut?: () => void) => {
      Alert.alert(
        "Sign Out?",
        `Sign out of ${session.label}? Downloaded audio stays on this device, and you'll need the password to sign back in.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign Out",
            style: "destructive",
            onPress: () => {
              void (async () => {
                await explicitLogout({ stayInSignIns: true });
                onSignedOut?.();
              })();
            },
          },
        ],
      );
    },
    [explicitLogout],
  );
};
