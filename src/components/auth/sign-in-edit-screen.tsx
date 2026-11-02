import {
  authStorage,
  getSessionKey,
  type RememberedSessionRecord,
} from "@/auth/auth-storage";
import { selectAccessMode, useAuthActions, useAuthStore } from "@/auth/auth-store";
import { enterUserSession } from "@/auth/enter-user-session";
import { getDefaultSessionColor } from "@/auth/session-color";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import { useConfirmRemoveSignIn } from "@/auth/use-confirm-remove-sign-in";
import { useConfirmSignOut } from "@/auth/use-confirm-sign-out";
import { normalizeAccentHex } from "@/theme/accent-color";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  Button,
  ColorPicker,
  HStack,
  Host,
  LabeledContent,
  List,
  Section,
  SecureField,
  Text as SwiftText,
  TextField,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  buttonStyle,
  controlSize,
  foregroundStyle,
  keyboardType,
  listRowBackground,
  multilineTextAlignment,
  scrollContentBackground,
  textContentType,
  textInputAutocapitalization,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

const ERROR_COLOR = "#dc2626";
const HTTPS_COLOR = "#16a34a";
const HTTP_COLOR = "#2563eb";

type ServerProtocol = "https://" | "http://";

const resolveParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

// The scheme is chosen with the protocol toggle, so the host field never holds one.
const splitServerUrl = (value: string): { protocol: ServerProtocol; host: string } => {
  const match = value.trim().match(/^(https?):\/\/(.*)$/i);
  if (!match) return { protocol: "https://", host: value.trim() };
  return { protocol: match[1].toLowerCase() === "http" ? "http://" : "https://", host: match[2] };
};

const buildServerUrl = (protocol: ServerProtocol, host: string) => {
  const trimmedHost = host.trim();
  return trimmedHost ? `${protocol}${trimmedHost}` : "";
};

// Leaving a sign-in should land on Manage Sign-Ins so another sign-in can be picked.
const returnToSignIns = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/login" as never);
  }
};

type SignInDetailScreenProps = {
  /** Present to edit a remembered sign-in; absent to add a new one. */
  session?: RememberedSessionRecord;
};

/** The Sign-In Detail page, shared by Add Sign-In and Edit Sign-In. */
function SignInDetailScreen({ session }: SignInDetailScreenProps) {
  const isAdding = !session;
  const themeColors = useThemeColors();
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const storedServerUrl = useAuthStore((state) => state.serverUrl);
  const lastAuthError = useAuthStore((state) => state.lastAuthError);
  const accessMode = useAuthStore(selectAccessMode);
  // First-run sign-in is reached from the Welcome Choice, so it can go back there.
  const canLeaveSignIn = accessMode !== "firstRunSignInRequired" || router.canGoBack();
  const { setLoginRequired, updateRememberedSession } = useAuthActions();
  const applyResolution = useApplySessionEntryResolution();
  const confirmSignOut = useConfirmSignOut();
  const confirmRemoveSignIn = useConfirmRemoveSignIn();
  const params = useLocalSearchParams<{
    mode?: string;
    returnToLibraryItemId?: string | string[];
  }>();
  const isSheet = params.mode === "sheet";
  const returnToLibraryItemId = resolveParam(params.returnToLibraryItemId);
  const isActive = Boolean(session) && session?.key === activeSessionKey;

  const initialServer = splitServerUrl(session?.serverUrl ?? storedServerUrl ?? "");
  const initialUsername = session?.username ?? "";
  const serverState = useNativeState(initialServer.host);
  const usernameState = useNativeState(initialUsername);
  const labelState = useNativeState(session?.label ?? "");
  const passwordState = useNativeState("");
  const [serverProtocol, setServerProtocol] = useState<ServerProtocol>(initialServer.protocol);
  const [serverHost, setServerHost] = useState(initialServer.host);
  const [username, setUsername] = useState(initialUsername);
  const [label, setLabel] = useState(() => session?.label ?? "");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState<string | null>(() => session?.color ?? null);
  // Signing out clears the stored password, so only offer "keep current" when one exists.
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const serverUrl = session?.serverUrl ?? buildServerUrl(serverProtocol, serverHost);
  const trimmedUsername = session?.username ?? username.trim();
  // A sign-in left unnamed is named after its username.
  const defaultLabel = trimmedUsername || "Username";
  // No session exists yet while adding, so derive the key it will get on submit. It drives the
  // "Automatic" color and updates as the user types their username and server.
  const colorKey = useMemo(
    () => session?.key ?? getSessionKey(trimmedUsername, serverUrl),
    [session?.key, trimmedUsername, serverUrl],
  );

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    authStorage.getSessionSecrets(session.key).then((secrets) => {
      if (!cancelled) setHasStoredPassword(Boolean(secrets.password));
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // A pasted full URL sets the toggle and keeps only the host in the field.
  const handleServerHostChange = (text: string) => {
    const { protocol, host } = splitServerUrl(text);
    if (host !== text.trim()) {
      setServerProtocol(protocol);
      serverState.set(host);
    }
    setServerHost(host);
  };

  const handleBack = () => {
    if (isAdding) setLoginRequired(false);
    router.back();
  };

  const handleAdd = async () => {
    if (!trimmedUsername || !password || !serverUrl) {
      setLocalError("Enter a server, username, and password.");
      return;
    }

    const resolution = await enterUserSession({
      via: "credentials",
      username: trimmedUsername,
      password,
      serverUrl,
      label: label.trim() || trimmedUsername,
      color,
    });
    await applyResolution(resolution, {
      returnToLibraryItemId,
      onError: setLocalError,
    });
  };

  const handleUpdate = async (existing: RememberedSessionRecord) => {
    await updateRememberedSession(existing.key, {
      label: label.trim() || existing.username,
      password: password.trim() || undefined,
      color,
    });

    const shouldRestore = existing.needsAttention || existing.key === activeSessionKey;
    if (shouldRestore) {
      const resolution = await enterUserSession({ via: "restore", sessionKey: existing.key });
      await applyResolution(resolution, {
        returnToLibraryItemId,
        onError: setLocalError,
      });
      return;
    }

    router.back();
  };

  const handleSave = async () => {
    if (isSaving) return;

    setLocalError(null);
    setIsSaving(true);
    try {
      if (session) {
        await handleUpdate(session);
      } else {
        await handleAdd();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save sign-in";
      setLocalError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const errorMessage = localError ?? (isAdding ? lastAuthError : null);
  const rowBackground = listRowBackground(themeColors.surface);
  const valueStyle = foregroundStyle(themeColors.textMuted);
  const fieldModifiers = [
    multilineTextAlignment("trailing"),
    textInputAutocapitalization("never"),
    autocorrectionDisabled(),
  ];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: isAdding ? "Add Sign-In" : "Edit Sign-In",
          headerLeft: () =>
            canLeaveSignIn ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={handleBack}
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
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isAdding ? "Sign In" : "Save"}
              onPress={handleSave}
              disabled={isSaving}
              hitSlop={12}
            >
              {isSaving ? (
                <ActivityIndicator color={themeColors.accent} />
              ) : (
                <Text style={{ color: themeColors.accent, fontSize: 17, fontWeight: "600" }}>
                  {isAdding ? "Sign In" : "Save"}
                </Text>
              )}
            </Pressable>
          ),
        }}
      />
      <Host style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <List
          modifiers={[
            scrollContentBackground("hidden"),
            background(themeColors.bg),
            tint(themeColors.accent),
          ]}
        >
          {errorMessage || (isAdding && isSheet) ? (
            <Section modifiers={[rowBackground]}>
              <SwiftText
                modifiers={[foregroundStyle(errorMessage ? ERROR_COLOR : themeColors.textMuted)]}
              >
                {errorMessage ?? "Sign in to stream. Downloads stay available offline."}
              </SwiftText>
            </Section>
          ) : null}

          <Section
            title="Account"
            modifiers={[rowBackground]}
            footer={
              <SwiftText>
                {isAdding
                  ? "Tap https:// to use http:// for a server without HTTPS."
                  : hasStoredPassword
                    ? "Server and username identify this sign-in and can't be changed. Leave the password blank to keep the current one."
                    : "Server and username identify this sign-in and can't be changed."}
              </SwiftText>
            }
          >
            {isAdding ? (
              <HStack spacing={10}>
                <Button
                  label={serverProtocol}
                  onPress={() =>
                    setServerProtocol((current) => (current === "https://" ? "http://" : "https://"))
                  }
                  modifiers={[
                    buttonStyle("bordered"),
                    controlSize("small"),
                    tint(serverProtocol === "https://" ? HTTPS_COLOR : HTTP_COLOR),
                    accessibilityLabel(
                      serverProtocol === "https://"
                        ? "HTTPS, tap to use HTTP"
                        : "HTTP, tap to use HTTPS",
                    ),
                  ]}
                />
                <TextField
                  text={serverState}
                  onTextChange={handleServerHostChange}
                  placeholder="abs.example.com"
                  modifiers={[
                    textInputAutocapitalization("never"),
                    autocorrectionDisabled(),
                    keyboardType("url"),
                    textContentType("URL"),
                  ]}
                />
              </HStack>
            ) : (
              <LabeledContent label="Server">
                <SwiftText modifiers={[valueStyle]}>{session.serverUrl}</SwiftText>
              </LabeledContent>
            )}
            <LabeledContent label="Username">
              {isAdding ? (
                <TextField
                  text={usernameState}
                  onTextChange={setUsername}
                  placeholder="username"
                  modifiers={[...fieldModifiers, textContentType("username")]}
                />
              ) : (
                <SwiftText modifiers={[valueStyle]}>{session.username}</SwiftText>
              )}
            </LabeledContent>
            <LabeledContent label="Password">
              <SecureField
                text={passwordState}
                onTextChange={setPassword}
                placeholder={hasStoredPassword ? "Keep current" : "Required"}
                modifiers={[multilineTextAlignment("trailing"), textContentType("password")]}
              />
            </LabeledContent>
          </Section>

          <Section
            title="Display"
            modifiers={[rowBackground]}
            footer={
              <SwiftText>
                Color tints this sign-in on the Home screen. Automatic picks one for you.
              </SwiftText>
            }
          >
            {/* An HStack keeps the field on the label's line; LabeledContent wraps it below. */}
            <HStack spacing={12}>
              <SwiftText>Name</SwiftText>
              <TextField
                text={labelState}
                onTextChange={setLabel}
                placeholder={defaultLabel}
                modifiers={fieldModifiers}
              />
            </HStack>
            <ColorPicker
              label="Color"
              supportsOpacity={false}
              selection={color ?? getDefaultSessionColor(colorKey)}
              onSelectionChange={(value) => setColor(normalizeAccentHex(value) ?? value)}
            />
            {color ? (
              <Button
                label="Use Automatic Color"
                onPress={() => setColor(null)}
                modifiers={[buttonStyle("borderless")]}
              />
            ) : null}
          </Section>

          {session ? (
            <Section modifiers={[rowBackground]}>
              {isActive ? (
                <Button
                  label="Sign Out"
                  systemImage="rectangle.portrait.and.arrow.right"
                  onPress={() => confirmSignOut(session, returnToSignIns)}
                  modifiers={[buttonStyle("borderless")]}
                />
              ) : null}
              <Button
                label="Remove Sign-In"
                systemImage="trash"
                role="destructive"
                onPress={() => confirmRemoveSignIn(session, { onRemoved: returnToSignIns })}
                modifiers={[buttonStyle("borderless")]}
              />
            </Section>
          ) : null}
        </List>
      </Host>
    </>
  );
}

export function SignInAddScreen() {
  return <SignInDetailScreen />;
}

export function SignInEditScreen() {
  const themeColors = useThemeColors();
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const params = useLocalSearchParams<{ sessionKey?: string | string[] }>();
  const sessionKey = resolveParam(params.sessionKey);
  const session = useMemo(
    () => sessions.find((item) => item.key === sessionKey),
    [sessionKey, sessions],
  );

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

  // Keyed so the form's local field state starts fresh for each sign-in.
  return <SignInDetailScreen key={session.key} session={session} />;
}
