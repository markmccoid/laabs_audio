import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { useAuthStore } from "@/auth/auth-store";
import HomeShelvesScreen from "@/components/Home/home-shelves-screen";
import { homeSessionSwitchStore, useHomeSessionSwitch } from "@/components/Home/home-session-switch-store";
import { PodcastHomeShelvesScreen } from "@/components/podcast/podcast-home-shelves-screen";
import { useThemeColors } from "@/theme/use-app-theme";
import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Text, View } from "react-native";

export default function HomeIndex() {
  const experience = useActiveLibraryExperience();
  const pendingSessionKey = useHomeSessionSwitch((state) => state.pendingSessionKey);
  const previousExperience = useHomeSessionSwitch((state) => state.previousExperience);
  const entryResolved = useHomeSessionSwitch((state) => state.entryResolved);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const activeLibraryReady = useAuthStore((state) => state.activeLibraryReady);
  const themeColors = useThemeColors();
  const [overlayOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (
      pendingSessionKey &&
      entryResolved &&
      activeSessionKey === pendingSessionKey &&
      experience === "podcast" &&
      activeLibraryReady
    ) {
      homeSessionSwitchStore.getState().actions.clear();
    }
  }, [activeLibraryReady, activeSessionKey, entryResolved, experience, pendingSessionKey]);

  useEffect(() => {
    if (pendingSessionKey) {
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [overlayOpacity, pendingSessionKey]);

  const visibleExperience =
    experience === "unresolved" && pendingSessionKey ? previousExperience : experience;

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      {visibleExperience === "podcast" ? (
        <PodcastHomeShelvesScreen />
      ) : visibleExperience === "book" ? (
        <HomeShelvesScreen />
      ) : null}
      <Animated.View
        pointerEvents={pendingSessionKey ? "auto" : "none"}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: overlayOpacity,
          backgroundColor: themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={themeColors.accent} />
        <Text style={{ marginTop: 12, color: themeColors.textMuted, fontSize: 15 }}>
          Loading library
        </Text>
      </Animated.View>
    </View>
  );
}
