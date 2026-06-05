import { getDefaultSessionLabel } from "@/auth/auth-storage";
import { prepareForSignInChange } from "@/auth/session-boundary";
import { useAuthActions, useAuthStore } from "@/auth/auth-store";
import { useCompleteSessionEntry } from "@/auth/use-complete-session-entry";
import { useThemeColors } from "@/theme/use-app-theme";
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

const resolveParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export function SignInEditScreen() {
  const themeColors = useThemeColors();
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const isOnline = useAuthStore((state) => state.isOnline);
  const { updateRememberedSession, restoreRememberedSession } = useAuthActions();
  const completeSessionEntry = useCompleteSessionEntry();
  const params = useLocalSearchParams<{
    sessionKey?: string | string[];
    mode?: string;
    returnToLibraryItemId?: string | string[];
  }>();
  const sessionKey = resolveParam(params.sessionKey);
  const mode = typeof params.mode === "string" ? params.mode : "required";
  const returnToLibraryItemId = resolveParam(params.returnToLibraryItemId);
  const session = useMemo(
    () => sessions.find((item) => item.key === sessionKey),
    [sessionKey, sessions],
  );
  const [label, setLabel] = useState(() => session?.label ?? "");
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
      });

      const shouldRestore = session.needsAttention || session.key === activeSessionKey;
      if (shouldRestore) {
        if (isOnline === false) {
          throw new Error("You are offline. Connect to the internet to sign in.");
        }
        await prepareForSignInChange({ userId: session.userId, sessionKey: session.key });
        await restoreRememberedSession(session.key);
        await completeSessionEntry({
          mode,
          returnToLibraryItemId,
          activeLibraryId: session.activeLibraryId,
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
            <Text style={{ color: themeColors.textMuted, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>
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
            <Text style={{ color: themeColors.textMuted, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>
              Username
            </Text>
            <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
              {session.username}
            </Text>
          </View>

          <View>
            <Text style={{ color: themeColors.textMuted, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>
              Server
            </Text>
            <Text selectable style={{ color: themeColors.text, fontSize: 16 }}>
              {session.serverUrl}
            </Text>
          </View>

          <View>
            <Text style={{ color: themeColors.textMuted, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>
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
          onPress={() => router.back()}
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
          <Text style={{ color: themeColors.text, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
            Cancel
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
