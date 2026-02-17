import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useAuthActions, useAuthStore } from "../auth/auth-store";

export default function LoginScreen() {
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const storedServerUrl = useAuthStore((state) => state.serverUrl);
  const isOnline = useAuthStore((state) => state.isOnline);
  const lastAuthError = useAuthStore((state) => state.lastAuthError);
  const { loginWithPassword, setLoginRequired } = useAuthActions();
  const params = useLocalSearchParams<{ mode?: string }>();

  const mode = useMemo(() => {
    return typeof params.mode === "string" ? params.mode : "required";
  }, [params.mode]);
  const isSheet = mode === "sheet";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (storedUsername) setUsername(storedUsername);
    if (storedServerUrl) setServerUrl(storedServerUrl);
  }, [storedServerUrl, storedUsername]);

  const handleClose = () => {
    setLoginRequired(false);
    router.back();
  };

  const handleLogin = async () => {
    setLocalError(null);

    if (!isOnline) {
      setLocalError("You are offline. Connect to the internet to log in.");
      return;
    }

    if (!username || !password || !serverUrl) {
      setLocalError("Please enter username, password, and server URL.");
      return;
    }

    setIsSubmitting(true);
    try {
      await loginWithPassword(username.trim(), password, serverUrl.trim());
      if (isSheet) {
        setLoginRequired(false);
        router.back();
      } else {
        router.replace("/(tabs)/(home)");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const content = (
    <View
      className={isSheet ? "rounded-t-3xl bg-white px-6 pb-8 pt-6" : "flex-1 bg-white px-6 pt-24"}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-3xl font-semibold text-neutral-900">Sign in</Text>
        {isSheet ? (
          <Pressable onPress={handleClose} className="rounded-full bg-neutral-100 px-3 py-1">
            <Text className="text-sm text-neutral-700">Close</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="mt-2 text-neutral-600">
        {isSheet
          ? "Login required to stream. Offline downloads remain available."
          : "Enter your Audiobookshelf server details."}
      </Text>

      <View className="mt-6 gap-4">
        <View>
          <Text className="mb-2 text-sm font-medium text-neutral-700">Server URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://your-server.example.com"
            className="rounded-xl border border-neutral-200 px-4 py-3 text-base"
          />
        </View>

        <View>
          <Text className="mb-2 text-sm font-medium text-neutral-700">Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            className="rounded-xl border border-neutral-200 px-4 py-3 text-base"
          />
        </View>

        <View>
          <Text className="mb-2 text-sm font-medium text-neutral-700">Password</Text>
          <TextInput
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="password"
            className="rounded-xl border border-neutral-200 px-4 py-3 text-base"
          />
        </View>
      </View>

      {localError ? <Text className="mt-4 text-sm text-red-600">{localError}</Text> : null}

      {!localError && lastAuthError ? (
        <Text className="mt-4 text-sm text-red-600">{lastAuthError}</Text>
      ) : null}

      <Pressable
        onPress={handleLogin}
        className="mt-6 rounded-xl bg-neutral-900 px-4 py-3"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-center text-base font-semibold text-white">Sign in</Text>
        )}
      </Pressable>
    </View>
  );

  if (!isSheet) {
    return content;
  }

  return (
    <View className="flex-1 justify-end bg-black/40">
      <Pressable className="flex-1" onPress={handleClose} />
      {content}
    </View>
  );
}
