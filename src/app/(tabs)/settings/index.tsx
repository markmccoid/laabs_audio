import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuthActions, useAuthStore } from "../../../auth/auth-store";

const Settings = () => {
  const status = useAuthStore((state) => state.status);
  const isOnline = useAuthStore((state) => state.isOnline);
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const { logout } = useAuthActions();

  return (
    <View className="flex-1 bg-bg px-6 pt-20">
      <Text className="text-2xl font-semibold text-text">Settings</Text>
      <Text className="mt-4 text-sm text-text-muted">Status: {status}</Text>
      <Text className="mt-2 text-sm text-text-muted">
        Online: {isOnline ? "Yes" : "No"}
      </Text>
      {storedUsername ? (
        <Text className="mt-2 text-sm text-text-muted">
          User: {storedUsername}
        </Text>
      ) : null}
      {serverUrl ? (
        <Text className="mt-2 text-sm text-text-muted">
          Server: {serverUrl}
        </Text>
      ) : null}
      {activeLibraryName ? (
        <Text className="mt-2 text-sm text-text-muted">
          Active library: {activeLibraryName}
        </Text>
      ) : null}

      <Pressable
        onPress={() => router.push("/library-picker")}
        className="mt-4 rounded-xl border border-border bg-surface px-4 py-3"
      >
        <Text className="text-center text-base font-semibold text-text">
          Change library
        </Text>
      </Pressable>

      <Pressable
        onPress={() => logout().catch(() => undefined)}
        className="mt-3 rounded-xl bg-accent px-4 py-3"
      >
        <Text className="text-center text-base font-semibold text-white">
          Log out
        </Text>
      </Pressable>
    </View>
  );
};

export default Settings;
