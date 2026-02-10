import { useEffect } from "react";
import { Stack, router, useSegments } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import "../global.css";

export default function RootLayout() {
  const { status } = useAuthBootstrap();
  const segments = useSegments();

  useEffect(() => {
    if (status === "hydrating") return;

    const rootSegment = segments[0];
    const inLogin = rootSegment === "login";
    const inTabs = rootSegment === "(tabs)";

    if (status === "anonymous" && !inLogin) {
      router.replace("/login");
      return;
    }

    if (status !== "anonymous" && !inTabs) {
      router.replace("/(tabs)");
    }
  }, [segments, status]);

  if (status === "hydrating") {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
    </Stack>
  );
}
