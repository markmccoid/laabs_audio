import { router, useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { selectAccessMode, useAuthStore } from "../auth/auth-store";
import { useThemeColors } from "../theme/use-app-theme";

/**
 * Session Needs Sign-In: the server rejected the active sign-in. The user stays in the app with
 * their downloaded and imported books; this banner is the way back to a working session.
 */
export const SessionSignInBanner = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const rootSegment = segments[0];
  const needsSignIn = useAuthStore((state) => selectAccessMode(state) === "downloadedSessionOnly");
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const storedUsername = useAuthStore((state) => state.storedUsername);

  if (!needsSignIn || rootSegment === "main-player" || rootSegment === "login") return null;

  const openSignIn = () => {
    router.push(
      activeSessionKey
        ? ({ pathname: "/login/edit", params: { sessionKey: activeSessionKey } } as never)
        : "/login",
    );
  };

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
          name="person.crop.circle.badge.exclamationmark"
          size={15}
          tintColor={themeColors.textMuted}
        />
        <Text numberOfLines={2} style={{ color: themeColors.textMuted, fontSize: 13, flexShrink: 1 }}>
          {storedUsername
            ? `Sign in again as ${storedUsername} to stream and sync. Downloaded books can still play.`
            : "Sign in again to stream and sync. Downloaded books can still play."}
        </Text>
      </View>

      <Pressable
        onPress={openSignIn}
        accessibilityRole="button"
        accessibilityLabel="Sign in again"
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: themeColors.border,
          borderRadius: 999,
          borderCurve: "continuous",
          paddingHorizontal: 12,
          paddingVertical: 6,
          backgroundColor: themeColors.bg,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: "600" }}>Sign In</Text>
      </Pressable>
    </View>
  );
};
