import { Stack } from "expo-router";
import { useThemeColors } from "@/theme/use-app-theme";

export default function LoginLayout() {
  const themeColors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: themeColors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="add" />
      <Stack.Screen name="edit" />
    </Stack>
  );
}
