import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

export const SettingsAuthenticationScreen = () => {
  const themeColors = useThemeColors();

  useEffect(() => {
    router.replace("/login");
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: themeColors.bg,
      }}
    >
      <ActivityIndicator color={themeColors.accent} />
    </View>
  );
};
