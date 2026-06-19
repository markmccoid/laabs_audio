import { getDefaultSessionLabel, getSessionKey } from "@/auth/auth-storage";
import { selectAccessMode, useAuthActions, useAuthStore } from "@/auth/auth-store";
import { enterUserSession } from "@/auth/enter-user-session";
import { getDefaultSessionColor, resolveSessionColor } from "@/auth/session-color";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import Dropdown from "@/shared/ui/organisms/dropdown";
import { normalizeAccentHex } from "@/theme/accent-color";
import { useThemeColors } from "@/theme/use-app-theme";
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import { router, Stack, useLocalSearchParams } from "expo-router";
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
import { useUniwind } from "uniwind";

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

export function SignInFormScreen() {
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const storedServerUrl = useAuthStore((state) => state.serverUrl);
  const accessMode = useAuthStore(selectAccessMode);
  const lastAuthError = useAuthStore((state) => state.lastAuthError);
  const { setLoginRequired } = useAuthActions();
  const applyResolution = useApplySessionEntryResolution();
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const scheme = theme === "dark" ? "dark" : "light";
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
  const [sessionLabel, setSessionLabel] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [serverProtocol, setServerProtocol] = useState<ServerProtocol>(
    () => splitServerUrl(storedServerUrl).protocol,
  );
  const [serverHost, setServerHost] = useState(() => splitServerUrl(storedServerUrl).host);
  const [color, setColor] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // No session exists yet, so derive the deterministic key the session will get on
  // submit. It drives the "Automatic" color preview/default and updates as the user
  // types their username/server.
  const previewKey = useMemo(
    () => getSessionKey(username.trim(), buildServerUrl(serverProtocol, serverHost)),
    [username, serverProtocol, serverHost],
  );

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

    if (!username || !password || !serverHost) {
      setLocalError("Please enter username, password, and server URL.");
      return;
    }

    const finalServerUrl = buildServerUrl(serverProtocol, serverHost);
    setIsSubmitting(true);
    try {
      const trimmedUsername = username.trim();
      const finalLabel =
        sessionLabel.trim() || getDefaultSessionLabel(trimmedUsername, finalServerUrl);
      const resolution = await enterUserSession({
        via: "credentials",
        username: trimmedUsername,
        password,
        serverUrl: finalServerUrl,
        label: finalLabel,
        color,
      });
      await applyResolution(resolution, {
        returnToLibraryItemId,
        onError: setLocalError,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const form = (
    <View
      className={
        isSheet ? "rounded-t-3xl bg-surface px-6 pb-8 pt-6" : "flex-1 bg-bg px-6 pb-8 pt-4"
      }
    >
      {isSheet ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-3xl font-semibold text-text">Add Sign-In</Text>
          <Pressable
            onPress={handleClose}
            className="rounded-full border border-border bg-bg px-3 py-1"
          >
            <Text className="text-sm text-text-muted">Close</Text>
          </Pressable>
        </View>
      ) : null}
      <Text className={isSheet ? "mt-2 text-text-muted" : "text-text-muted mb-2"}>
        {isSheet
          ? "Login required to stream. Offline downloads remain available."
          : "Enter your Audiobookshelf sign-in details."}
      </Text>

      <View className="mt-6 gap-4">
        <View>
          <Text className="mb-2 text-sm font-medium text-text-muted">Session Label</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={sessionLabel}
            onChangeText={setSessionLabel}
            placeholder={
              username.trim() && serverHost.trim()
                ? getDefaultSessionLabel(
                    username.trim(),
                    buildServerUrl(serverProtocol, serverHost),
                  )
                : "user @ server"
            }
            placeholderTextColor={themeColors.textMuted}
            selectionColor={themeColors.accent}
            className="rounded-xl border border-border bg-surface px-4 text-text"
            style={{ color: themeColors.text, paddingVertical: 15, fontSize: 16 }}
          />
        </View>

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
                keyboardType="url"
                autoCorrect={false}
                value={serverHost}
                onChangeText={setServerHost}
                placeholder="your-server.example.com"
                placeholderTextColor={themeColors.textMuted}
                selectionColor={themeColors.accent}
                className="flex-1 px-4 text-text items-center flex-row"
                style={{ color: themeColors.text, fontSize: 16 }}
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
            className="rounded-xl border border-border bg-surface px-4 text-text"
            style={{ color: themeColors.text, paddingVertical: 15, fontSize: 16 }}
          />
        </View>

        <View>
          <Text className="mb-2 text-sm font-medium text-text-muted">Password</Text>
          <View
            className="flex-row items-center rounded-xl border border-border bg-surface px-4"
            style={{ minHeight: 50 }}
          >
            <TextInput
              secureTextEntry={!isPasswordVisible}
              value={password}
              onChangeText={setPassword}
              placeholder="password"
              placeholderTextColor={themeColors.textMuted}
              selectionColor={themeColors.accent}
              className="flex-1 text-text"
              style={{ color: themeColors.text, paddingVertical: 15, fontSize: 16 }}
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

        {Platform.OS === "ios" ? (
          <View>
            <Text className="mb-2 text-sm font-medium text-text-muted">Color</Text>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  borderCurve: "continuous",
                  backgroundColor: resolveSessionColor(
                    { key: previewKey, color },
                    scheme,
                    themeColors.bg,
                  ),
                  borderWidth: 1,
                  borderColor: themeColors.border,
                }}
              />
              <Text className="flex-1 text-base text-text" style={{ color: themeColors.text }}>
                {color ?? "Automatic"}
              </Text>
              <Host matchContents>
                <ColorPicker
                  label=""
                  supportsOpacity={false}
                  selection={color ?? getDefaultSessionColor(previewKey)}
                  onSelectionChange={(value) => setColor(normalizeAccentHex(value) ?? value)}
                />
              </Host>
            </View>
            {color ? (
              <Pressable onPress={() => setColor(null)} hitSlop={6} className="mt-3">
                <Text
                  className="text-sm font-semibold text-accent"
                  style={{ color: themeColors.accent }}
                >
                  Use automatic color
                </Text>
              </Pressable>
            ) : null}
            <Text className="mt-2 text-xs text-text-muted">
              Tints this sign-in on the Home screen. Automatic picks a color for you.
            </Text>
          </View>
        ) : null}
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
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            title: "Add Sign-In",
            headerLeft: () =>
              accessMode !== "firstRunSignInRequired" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  onPress={handleCancel}
                  hitSlop={12}
                  style={{ flexDirection: "row", alignItems: "center", marginLeft: -8, padding: 8 }}
                >
                  <SymbolView
                    name="chevron.left"
                    tintColor={themeColors.accent}
                    size={24}
                    weight="semibold"
                  />
                </Pressable>
              ) : null,
          }}
        />
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
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
