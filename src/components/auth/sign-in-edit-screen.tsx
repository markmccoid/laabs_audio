import { getDefaultSessionLabel } from "@/auth/auth-storage";
import { selectAccessMode, useAuthActions, useAuthStore } from "@/auth/auth-store";
import { enterUserSession } from "@/auth/enter-user-session";
import {
  getDefaultSessionColor,
  resolveColorForScheme,
  resolveSessionColor,
  SESSION_COLOR_PALETTE,
} from "@/auth/session-color";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import { getAccentForegroundColor, normalizeAccentHex } from "@/theme/accent-color";
import { useThemeColors } from "@/theme/use-app-theme";
import { ColorPicker, Host } from "@expo/ui/swift-ui";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { useUniwind } from "uniwind";
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

const resolveParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export function SignInEditScreen() {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const scheme = theme === "dark" ? "dark" : "light";
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const accessMode = useAuthStore(selectAccessMode);
  const { updateRememberedSession } = useAuthActions();
  const applyResolution = useApplySessionEntryResolution();
  const params = useLocalSearchParams<{
    sessionKey?: string | string[];
    mode?: string;
    returnToLibraryItemId?: string | string[];
  }>();
  const sessionKey = resolveParam(params.sessionKey);
  const returnToLibraryItemId = resolveParam(params.returnToLibraryItemId);
  const session = useMemo(
    () => sessions.find((item) => item.key === sessionKey),
    [sessionKey, sessions],
  );
  const [label, setLabel] = useState(() => session?.label ?? "");
  const [color, setColor] = useState<string | null>(() => session?.color ?? null);
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!session || isSaving) return;

    setLocalError(null);
    setIsSaving(true);
    try {
      await updateRememberedSession(session.key, {
        label: label.trim() || getDefaultSessionLabel(session.username, session.serverUrl),
        password: password.trim() || undefined,
        color,
      });

      const shouldRestore = session.needsAttention || session.key === activeSessionKey;
      if (shouldRestore) {
        const resolution = await enterUserSession({ via: "restore", sessionKey: session.key });
        await applyResolution(resolution, {
          returnToLibraryItemId,
          onError: setLocalError,
        });
        return;
      }

      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save sign-in";
      setLocalError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  if (!session) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: themeColors.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
          Sign-in not found
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 16,
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: themeColors.accent,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: themeColors.accentForeground, fontSize: 16, fontWeight: "700" }}>
            Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
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
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: 32,
          gap: 16,
        }}
      >
        <View>
          <Text selectable style={{ color: themeColors.text, fontSize: 28, fontWeight: "700" }}>
            Edit Sign-In
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 14, marginTop: 4 }}>
            Server and username identify this sign-in and are not edited in place.
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <View>
            <Text
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              Session Label
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              value={label}
              onChangeText={setLabel}
              placeholder={getDefaultSessionLabel(session.username, session.serverUrl)}
              placeholderTextColor={themeColors.textMuted}
              selectionColor={themeColors.accent}
              style={{
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 12,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
                color: themeColors.text,
                fontSize: 16,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            />
          </View>

          <View>
            <Text
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              Username
            </Text>
            <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
              {session.username}
            </Text>
          </View>

          <View>
            <Text
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              Server
            </Text>
            <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
              {session.serverUrl}
            </Text>
          </View>

          <View>
            <Text
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              Password
            </Text>
            <View
              style={{
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 12,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
                paddingHorizontal: 14,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <TextInput
                secureTextEntry={!isPasswordVisible}
                value={password}
                onChangeText={setPassword}
                placeholder="Leave blank to keep current password"
                placeholderTextColor={themeColors.textMuted}
                selectionColor={themeColors.accent}
                style={{
                  flex: 1,
                  color: themeColors.text,
                  fontSize: 16,
                  paddingVertical: 12,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPasswordVisible ? "Hide password" : "Show password"}
                onPress={() => setIsPasswordVisible((current) => !current)}
                hitSlop={10}
                style={{ marginLeft: 12 }}
              >
                <SymbolView
                  name={isPasswordVisible ? "eye.slash" : "eye"}
                  tintColor={themeColors.textMuted}
                  size={18}
                />
              </Pressable>
            </View>
          </View>

          <View>
            <Text
              style={{
                color: themeColors.textMuted,
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              Color
            </Text>
            {Platform.OS === "ios" ? (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      borderCurve: "continuous",
                      backgroundColor: resolveSessionColor(
                        { key: session.key, color },
                        scheme,
                        themeColors.bg,
                      ),
                      borderWidth: 1,
                      borderColor: themeColors.border,
                    }}
                  />
                  <Text style={{ color: themeColors.text, fontSize: 16, flex: 1 }}>
                    {color ?? "Automatic"}
                  </Text>
                  <Host matchContents>
                    <ColorPicker
                      label=""
                      supportsOpacity={false}
                      selection={color ?? getDefaultSessionColor(session.key)}
                      onSelectionChange={(value) => setColor(normalizeAccentHex(value) ?? value)}
                    />
                  </Host>
                </View>
                {color ? (
                  <Pressable onPress={() => setColor(null)} hitSlop={6} style={{ marginTop: 12 }}>
                    <Text style={{ color: themeColors.accent, fontSize: 15, fontWeight: "600" }}>
                      Use automatic color
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {[null, ...SESSION_COLOR_PALETTE].map((value) => {
                  const base = value ?? getDefaultSessionColor(session.key);
                  const resolved = resolveColorForScheme(base, scheme);
                  const isSelected = color === value;
                  const isAuto = value === null;
                  return (
                    <Pressable
                      key={value ?? "auto"}
                      accessibilityRole="button"
                      accessibilityLabel={isAuto ? "Automatic color" : `Color ${base}`}
                      onPress={() => setColor(value)}
                      hitSlop={6}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        borderCurve: "continuous",
                        backgroundColor: resolved,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: isSelected ? 3 : 1,
                        borderColor: isSelected ? themeColors.text : themeColors.border,
                      }}
                    >
                      {isSelected ? (
                        <SymbolView
                          name="checkmark"
                          tintColor={getAccentForegroundColor(resolved)}
                          size={16}
                          weight="bold"
                        />
                      ) : isAuto ? (
                        <SymbolView
                          name="sparkles"
                          tintColor={getAccentForegroundColor(resolved)}
                          size={16}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 8 }}>
              Tints this sign-in on the Home screen. Automatic picks a color for you.
            </Text>
          </View>
        </View>

        {localError ? (
          <Text selectable style={{ color: "#dc2626", fontSize: 14 }}>
            {localError}
          </Text>
        ) : null}

        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={{
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: themeColors.accent,
            paddingHorizontal: 14,
            paddingVertical: 12,
            opacity: isSaving ? 0.75 : 1,
          }}
        >
          {isSaving ? (
            <ActivityIndicator color={themeColors.accentForeground} />
          ) : (
            <Text
              style={{
                color: themeColors.accentForeground,
                fontSize: 16,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              Save
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleCancel}
          disabled={isSaving}
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: themeColors.surface,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text
            style={{
              color: themeColors.text,
              fontSize: 16,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            Cancel
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
