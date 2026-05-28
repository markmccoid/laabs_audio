import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { useExplicitLogout } from "@/auth/use-explicit-logout";
import { usePlaybackStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const SettingsAuthenticationScreen = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const hasLoadedBook = usePlaybackStore(
    (state) => Boolean(state.libraryItemId) && state.queue.length > 0,
  );
  const logout = useExplicitLogout();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const canLogIn = accessMode !== "serverBrowsing" && accessMode !== "serverSetup";
  const canFinishLibrarySetup = accessMode === "serverSetup";
  const canChangeLibrary = accessMode === "serverBrowsing";
  const canLogOut = accessMode === "serverBrowsing" || accessMode === "downloadedSessionOnly";
  const sessionLabel =
    accessMode === "serverBrowsing"
      ? "Signed in"
      : accessMode === "serverSetup"
        ? "Choose library"
      : accessMode === "downloadedSessionOnly"
        ? "Sign in needed"
        : "Not signed in";
  const sessionDescription =
    accessMode === "serverSetup"
      ? "Select a library to finish signing in."
      : accessMode === "downloadedSessionOnly"
      ? "Downloaded books from this session remain available. Sign in to restore streaming, search, and sync."
      : accessMode === "downloadedOnly"
        ? "Sign in to use downloaded books on this device."
        : accessMode === "firstRunSignInRequired"
          ? "Sign in to connect this app to your Audiobookshelf server."
          : null;
  const bottomPadding = (hasLoadedBook ? 112 : 0) + Math.max(24, insets.bottom + 16);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      setIsLoggingOut(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: bottomPadding,
          gap: 14,
        }}
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
          <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
            {sessionLabel}
          </Text>
          {sessionDescription ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14, lineHeight: 20 }}>
              {sessionDescription}
            </Text>
          ) : null}
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
            Access: {accessMode}
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
            <Text style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}>
              Change Library
            </Text>
          </Pressable>
        ) : null}

        {canFinishLibrarySetup ? (
          <Pressable
            onPress={() => router.push({ pathname: "/library-picker", params: { mode: "setup" } })}
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: themeColors.accent,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Choose Library</Text>
          </Pressable>
        ) : null}

        {canLogIn ? (
          <Pressable
            onPress={() => router.push({ pathname: "/login", params: { mode: "required" } })}
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: themeColors.accent,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Sign In</Text>
          </Pressable>
        ) : null}

        {canLogOut ? (
          <Pressable
            onPress={() => {
              void handleLogout();
            }}
            disabled={isLoggingOut}
            style={({ pressed }) => ({
              borderRadius: 14,
              borderCurve: "continuous",
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: themeColors.accent,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: isLoggingOut ? 0.75 : pressed ? 0.86 : 1,
            })}
          >
            {isLoggingOut ? <ActivityIndicator color="#fff" size="small" /> : null}
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
              {isLoggingOut ? "Logging Out..." : "Log Out"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
};
