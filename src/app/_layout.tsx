import { Stack, router, useSegments } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "../auth/auth-store";
import { useAuthBootstrap } from "../auth/use-auth-bootstrap";
import "../global.css";

export default function RootLayout() {
  const { status } = useAuthBootstrap();
  const loginRequired = useAuthStore((state) => state.loginRequired);
  const segments = useSegments();

  useEffect(() => {
    if (status === "hydrating") return;

    const rootSegment = segments[0];
    const inLogin = rootSegment === "login";
    const inTabs = rootSegment === "(tabs)";
    console.log("STATUS", status, inLogin);
    if (status === "anonymous" && !inLogin) {
      router.replace({ pathname: "/login", params: { mode: "required" } });
      return;
    }

    if (status !== "anonymous" && !loginRequired && !inTabs) {
      router.replace("/(tabs)");
    }
  }, [loginRequired, segments, status]);

  useEffect(() => {
    if (!loginRequired) return;
    if (status === "anonymous") return;
    const rootSegment = segments[0];
    if (rootSegment === "login") return;
    router.push({ pathname: "/login", params: { mode: "sheet" } });
  }, [loginRequired, segments, status]);

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
      <Stack.Screen
        name="login"
        options={{
          presentation: "transparentModal",
          animation: "slide_from_bottom",
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
    </Stack>
  );
}
