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
    <View className="flex-1 bg-white px-6 pt-20">
      <Text className="text-2xl font-semibold text-neutral-900">Settings</Text>
      <Text className="mt-4 text-sm text-neutral-600">Status: {status}</Text>
      <Text className="mt-2 text-sm text-neutral-600">
        Online: {isOnline ? "Yes" : "No"}
      </Text>
      {storedUsername ? (
        <Text className="mt-2 text-sm text-neutral-600">
          User: {storedUsername}
        </Text>
      ) : null}
      {serverUrl ? (
        <Text className="mt-2 text-sm text-neutral-600">
          Server: {serverUrl}
        </Text>
      ) : null}
      {activeLibraryName ? (
        <Text className="mt-2 text-sm text-neutral-600">
          Active library: {activeLibraryName}
        </Text>
      ) : null}

      <Pressable
        onPress={() => router.push("/library-picker")}
        className="mt-4 rounded-xl border border-neutral-200 px-4 py-3"
      >
        <Text className="text-center text-base font-semibold text-neutral-900">
          Change library
        </Text>
      </Pressable>

      <Pressable
        onPress={() => logout().catch(() => undefined)}
        className="mt-3 rounded-xl bg-neutral-900 px-4 py-3"
      >
        <Text className="text-center text-base font-semibold text-white">
          Log out
        </Text>
      </Pressable>
    </View>
  );
};

export default Settings;
