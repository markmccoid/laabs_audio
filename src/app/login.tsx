import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { selectAccessMode, useAuthActions, useAuthStore } from "../auth/auth-store";
import { fetchLibrariesForResolution, resolveLibrarySelection } from "../auth/library-resolution";
import { useActivateLibrarySelection } from "../hooks/use-activate-library-selection";
import Dropdown from "../shared/ui/organisms/dropdown";
import { useThemeColors } from "../theme/use-app-theme";

const SERVER_PROTOCOLS = ["https://", "http://"] as const;
type ServerProtocol = (typeof SERVER_PROTOCOLS)[number];
const DEFAULT_SERVER_PROTOCOL: ServerProtocol = "https://";

const splitServerUrl = (value: string | null | undefined) => {
  const trimmedValue = value?.trim() ?? "";
  if (!trimmedValue) {
    return {
      protocol: DEFAULT_SERVER_PROTOCOL,
      host: "",
    };
  }

  const protocolMatch = trimmedValue.match(/^(https?:\/\/)(.*)$/i);
  if (!protocolMatch) {
    return {
      protocol: DEFAULT_SERVER_PROTOCOL,
      host: trimmedValue,
    };
  }

  const protocol: ServerProtocol =
    protocolMatch[1].toLowerCase() === "http://" ? "http://" : "https://";

  return {
    protocol,
    host: protocolMatch[2] ?? "",
  };
};

const buildServerUrl = (protocol: ServerProtocol, host: string) => {
  const trimmedHost = host.trim().replace(/^(https?:\/\/)/i, "");
  return `${protocol}${trimmedHost}`;
};

export default function LoginScreen() {
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const storedServerUrl = useAuthStore((state) => state.serverUrl);
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const lastAuthError = useAuthStore((state) => state.lastAuthError);
  const { loginWithPassword, setLoginRequired } = useAuthActions();
  const activateLibrarySelection = useActivateLibrarySelection();
  const themeColors = useThemeColors();
  const params = useLocalSearchParams<{
    mode?: string;
    returnToLibraryItemId?: string | string[];
  }>();

  const mode = useMemo(() => {
    return typeof params.mode === "string" ? params.mode : "required";
  }, [params.mode]);
  const isSheet = mode === "sheet";
  const returnToLibraryItemId = useMemo(() => {
    const rawValue = params.returnToLibraryItemId;
    if (Array.isArray(rawValue)) {
      return rawValue[0];
    }
    return typeof rawValue === "string" ? rawValue : undefined;
  }, [params.returnToLibraryItemId]);

  const [username, setUsername] = useState(() => storedUsername ?? "");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [serverProtocol, setServerProtocol] = useState<ServerProtocol>(
    () => splitServerUrl(storedServerUrl).protocol,
  );
  const [serverHost, setServerHost] = useState(() => splitServerUrl(storedServerUrl).host);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleClose = () => {
    setLoginRequired(false);
    router.back();
  };

  const handleCancel = () => {
    setLoginRequired(false);
    router.back();
  };

  const handleLogin = async () => {
    setLocalError(null);

    if (!isOnline) {
      setLocalError("You are offline. Connect to the internet to log in.");
      return;
    }

    if (!username || !password || !serverHost) {
      setLocalError("Please enter username, password, and server URL.");
      return;
    }

    const finalServerUrl = buildServerUrl(serverProtocol, serverHost);
    setIsSubmitting(true);
    try {
      await loginWithPassword(username.trim(), password, finalServerUrl);

      const response = await fetchLibrariesForResolution();
      const resolution = resolveLibrarySelection(response.libraries);

      if (resolution.status === "noLibraries") {
        setLocalError("This Audiobookshelf user does not have any libraries available.");
        return;
      }

      if (resolution.status === "needsLibrarySelection") {
        router.push({
          pathname: "/library-picker",
          params: {
            mode: "setup",
            ...(returnToLibraryItemId ? { returnToLibraryItemId } : null),
          },
        });
        return;
      }

      if (isSheet) {
        setLoginRequired(false);
      }

      await activateLibrarySelection(resolution.library, {
        mode: "setup",
        returnToLibraryItemId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const form = (
    <View
      className={
        isSheet ? "rounded-t-3xl bg-surface px-6 pb-8 pt-6" : "flex-1 bg-bg px-6 pb-8 pt-24"
      }
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-3xl font-semibold text-text">Sign in</Text>
        {isSheet ? (
          <Pressable
            onPress={handleClose}
            className="rounded-full border border-border bg-bg px-3 py-1"
          >
            <Text className="text-sm text-text-muted">Close</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className="mt-2 text-text-muted">
        {isSheet
          ? "Login required to stream. Offline downloads remain available."
          : "Enter your Audiobookshelf server details."}
      </Text>

      <View className="mt-6 gap-4">
        <View>
          <Text className="mb-2 text-sm font-medium text-text-muted">Server URL</Text>
          <Dropdown>
            <View
              className="flex-row items-center overflow-hidden rounded-xl border border-border bg-surface"
              style={{ minHeight: 50 }}
            >
              <Dropdown.Trigger style={{ minWidth: 112 }}>
                <View
                  className="flex-row items-center justify-between px-4 py-3"
                  style={{
                    minHeight: 50,
                    borderRightWidth: 1,
                    borderRightColor: themeColors.border,
                  }}
                >
                  <Text className="text-base text-text" style={{ color: themeColors.text }}>
                    {serverProtocol}
                  </Text>
                  <SymbolView name="chevron.down" tintColor={themeColors.textMuted} size={14} />
                </View>
              </Dropdown.Trigger>

              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                value={serverHost}
                onChangeText={setServerHost}
                placeholder="your-server.example.com"
                placeholderTextColor={themeColors.textMuted}
                selectionColor={themeColors.accent}
                className="flex-1 px-4 py-3 text-base text-text"
                style={{ color: themeColors.text }}
              />
            </View>

            <Dropdown.Content
              style={{
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.surface,
              }}
            >
              {SERVER_PROTOCOLS.map((protocol) => (
                <Dropdown.Item
                  key={protocol}
                  onPress={() => setServerProtocol(protocol)}
                  style={{ minHeight: 44 }}
                >
                  <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                    {protocol}
                  </Text>
                  {serverProtocol === protocol ? (
                    <SymbolView name="checkmark" tintColor={themeColors.accent} size={14} />
                  ) : null}
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown>
        </View>

        <View>
          <Text className="mb-2 text-sm font-medium text-text-muted">Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            placeholderTextColor={themeColors.textMuted}
            selectionColor={themeColors.accent}
            className="rounded-xl border border-border bg-surface px-4 py-3 text-base text-text"
            style={{ color: themeColors.text }}
          />
        </View>

        <View>
          <Text className="mb-2 text-sm font-medium text-text-muted">Password</Text>
          <View className="flex-row items-center rounded-xl border border-border bg-surface px-4">
            <TextInput
              secureTextEntry={!isPasswordVisible}
              value={password}
              onChangeText={setPassword}
              placeholder="password"
              placeholderTextColor={themeColors.textMuted}
              selectionColor={themeColors.accent}
              className="flex-1 py-3 text-base text-text"
              style={{ color: themeColors.text }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isPasswordVisible ? "Hide password" : "Show password"}
              onPress={() => setIsPasswordVisible((current) => !current)}
              className="ml-3"
              hitSlop={10}
            >
              <SymbolView
                name={isPasswordVisible ? "eye.slash" : "eye"}
                tintColor={themeColors.textMuted}
                size={18}
              />
            </Pressable>
          </View>
        </View>
      </View>

      {localError ? <Text className="mt-4 text-sm text-red-600">{localError}</Text> : null}

      {!localError && lastAuthError ? (
        <Text className="mt-4 text-sm text-red-600">{lastAuthError}</Text>
      ) : null}

      <Pressable
        onPress={handleLogin}
        className="mt-6 rounded-xl bg-accent px-4 py-3"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color={themeColors.accentForeground} />
        ) : (
          <Text className="text-center text-base font-semibold text-accent-foreground">
            Sign in
          </Text>
        )}
      </Pressable>

      {!isSheet && accessMode !== "firstRunSignInRequired" ? (
        <Pressable
          onPress={handleCancel}
          className="mt-3 rounded-xl border border-border bg-surface px-4 py-3"
          disabled={isSubmitting}
        >
          <Text className="text-center text-base font-semibold text-text">Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!isSheet) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-bg"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          {form}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={handleClose} />
        <ScrollView
          className="max-h-[85%]"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {form}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
