import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useAuthActions, useAuthStore } from "@/auth/auth-store";
import { useThemeColors } from "@/theme/use-app-theme";

export const SettingsAuthenticationScreen = () => {
  const themeColors = useThemeColors();
  const status = useAuthStore((state) => state.status);
  const isOnline = useAuthStore((state) => state.isOnline);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const { logout } = useAuthActions();
  const canLogIn = status !== "authenticated";
  const canChangeLibrary = status === "authenticated";

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 14 }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 16,
            borderCurve: "continuous",
            padding: 14,
            gap: 8,
            backgroundColor: themeColors.surface,
          }}
        >
          <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
            Session
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Status: {status}
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Online: {isOnline ? "Yes" : "No"}
          </Text>
          {storedUsername ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              User: {storedUsername}
            </Text>
          ) : null}
          {serverUrl ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              Server: {serverUrl}
            </Text>
          ) : null}
          {canChangeLibrary && activeLibraryName ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              Active library: {activeLibraryName}
            </Text>
          ) : null}
        </View>

        {canChangeLibrary ? (
          <Pressable
            onPress={() => router.push("/library-picker")}
            style={{
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 14,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: themeColors.surface,
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}>
              Change Library
            </Text>
          </Pressable>
        ) : null}

        {canLogIn ? (
          <Pressable
            onPress={() => router.replace({ pathname: "/login", params: { mode: "required" } })}
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: themeColors.accent,
            }}
          >
            <Text selectable style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
              Sign In
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => logout().catch(() => undefined)}
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: themeColors.accent,
            }}
          >
            <Text selectable style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
              Log Out
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
};
