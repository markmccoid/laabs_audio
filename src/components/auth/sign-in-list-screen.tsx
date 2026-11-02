import { enterUserSession } from "@/auth/enter-user-session";
import { isConnectionFailureKind } from "@/auth/server-connection";
import { selectAccessMode, useAuthStore } from "@/auth/auth-store";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import { useConfirmRemoveSignIn } from "@/auth/use-confirm-remove-sign-in";
import { useConfirmSignOut } from "@/auth/use-confirm-sign-out";
import { authStorage, type RememberedSessionRecord } from "@/auth/auth-storage";
import { resolveSessionColor } from "@/auth/session-color";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  Button,
  HStack,
  Host,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  SwipeActions,
  Text as SwiftText,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  labelStyle,
  listRowBackground,
  padding,
  scrollContentBackground,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import {
  router,
  Stack,
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
} from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
import { Pressable } from "react-native";
import { useUniwind } from "uniwind";

const resolveParam = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const ACTIVE_COLOR = "#16a34a";
const READY_COLOR = "#2563eb";
const ERROR_COLOR = "#dc2626";
const WARNING_COLOR = "#d97706";

export function SignInListScreen() {
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const scheme = theme === "dark" ? "dark" : "light";
  // The same per-sign-in tint the Home screen uses, so a sign-in reads the same in both places.
  const sessionColor = (session: RememberedSessionRecord) =>
    resolveSessionColor(session, scheme, themeColors.bg);
  // This screen stays on the stack under Home after a switch; unmount the native list while it
  // is covered so SwiftUI is not diffing it as Home loads.
  const isFocused = useIsFocused();
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const accessMode = useAuthStore(selectAccessMode);
  // First-run sign-in is reached from the Welcome Choice, so it can go back there.
  const canLeaveSignIn =
    accessMode !== "firstRunSignInRequired" || router.canGoBack();
  const confirmSignOut = useConfirmSignOut();
  const applyResolution = useApplySessionEntryResolution();
  const params = useLocalSearchParams<{
    mode?: string;
    returnToLibraryItemId?: string | string[];
  }>();
  const mode = typeof params.mode === "string" ? params.mode : "required";
  const returnToLibraryItemId = resolveParam(params.returnToLibraryItemId);
  const [pendingSessionKey, setPendingSessionKey] = useState<string | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  // Keyed by session; true when a stored password or token lets it be switched to without re-entry.
  const [canRestoreBySession, setCanRestoreBySession] = useState<
    Record<string, boolean>
  >({});

  // Re-read on focus too, since the edit screen can store a new password and pop back here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void Promise.all(
        sessions.map(async (session) => {
          const secrets = await authStorage.getSessionSecrets(session.key);
          return [
            session.key,
            Boolean(secrets.password || secrets.refreshToken),
          ] as const;
        }),
      ).then((entries) => {
        if (!cancelled) setCanRestoreBySession(Object.fromEntries(entries));
      });
      return () => {
        cancelled = true;
      };
    }, [sessions, activeSessionKey]),
  );
  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        if (a.key === activeSessionKey) return -1;
        if (b.key === activeSessionKey) return 1;
        return a.label.localeCompare(b.label);
      }),
    [activeSessionKey, sessions],
  );

  const openAdd = () => {
    router.push({
      pathname: "/login/add",
      params: {
        mode,
        ...(returnToLibraryItemId ? { returnToLibraryItemId } : {}),
      },
    } as never);
  };

  const openEdit = (session: RememberedSessionRecord) => {
    router.push({
      pathname: "/login/edit",
      params: {
        sessionKey: session.key,
        mode,
        ...(returnToLibraryItemId ? { returnToLibraryItemId } : {}),
      },
    } as never);
  };

  const restoreSession = async (session: RememberedSessionRecord) => {
    if (pendingSessionKey) return;

    setLocalError(null);
    setPendingSessionKey(session.key);
    try {
      const resolution = await enterUserSession({
        via: "restore",
        sessionKey: session.key,
      });
      await applyResolution(resolution, {
        returnToLibraryItemId,
        onError: setLocalError,
        onFailed: (failure) => {
          if (!isConnectionFailureKind(failure.kind)) {
            openEdit(session);
          }
        },
      });
    } finally {
      setPendingSessionKey(null);
    }
  };

  const confirmRemoveSignIn = useConfirmRemoveSignIn();
  const confirmRemove = (session: RememberedSessionRecord) =>
    confirmRemoveSignIn(session, {
      onPendingChange: (pending) =>
        setPendingSessionKey(pending ? session.key : null),
    });

  const switchTo = (session: RememberedSessionRecord) => {
    // A signed-out sign-in has nothing to restore with, so go straight to entering a password.
    if (canRestoreBySession[session.key] === false) {
      openEdit(session);
      return;
    }
    void restoreSession(session);
  };

  const activeSession = sortedSessions.find(
    (session) => session.key === activeSessionKey,
  );
  const otherSessions = sortedSessions.filter(
    (session) => session.key !== activeSessionKey,
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Sign-Ins",
          headerLeft: () =>
            canLeaveSignIn ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() => router.back()}
                hitSlop={12}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginLeft: -8,
                  padding: 8,
                }}
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
      {isFocused ? (
        <Host style={{ flex: 1, backgroundColor: themeColors.bg }}>
          <List
            modifiers={[
              scrollContentBackground("hidden"),
              background(themeColors.bg),
              tint(themeColors.accent),
            ]}
          >
            {activeSession ? (
              <Section modifiers={[listRowBackground(themeColors.surface)]}>
                {/* Plain and borderless buttons stay separately tappable within one list row. */}
                <VStack
                  alignment="leading"
                  spacing={4}
                  modifiers={[padding({ vertical: 8 })]}
                >
                  <HStack spacing={6}>
                    <Image
                      systemName="checkmark.circle.fill"
                      color={ACTIVE_COLOR}
                      size={15}
                    />
                    <SwiftText
                      modifiers={[
                        font({ size: 13, weight: "bold" }),
                        foregroundStyle(ACTIVE_COLOR),
                      ]}
                    >
                      SIGNED IN
                    </SwiftText>
                    <Spacer />
                    <HStack spacing={22}>
                      <Button
                        label="Sign Out"
                        systemImage="rectangle.portrait.and.arrow.right"
                        onPress={() => confirmSignOut(activeSession)}
                        modifiers={[
                          buttonStyle("borderless"),
                          labelStyle("iconOnly"),
                          font({ size: 20 }),
                        ]}
                      />
                      <Button
                        label="Remove Sign-In"
                        systemImage="trash"
                        role="destructive"
                        onPress={() => confirmRemove(activeSession)}
                        modifiers={[
                          buttonStyle("borderless"),
                          labelStyle("iconOnly"),
                          font({ size: 20 }),
                        ]}
                      />
                    </HStack>
                  </HStack>
                  <Button
                    onPress={() => openEdit(activeSession)}
                    modifiers={[
                      buttonStyle("plain"),
                      accessibilityLabel(`Edit ${activeSession.label}`),
                    ]}
                  >
                    <HStack spacing={12} alignment="center">
                      <VStack alignment="leading" spacing={4}>
                        <HStack spacing={8}>
                          <Image
                            systemName="circle.fill"
                            color={sessionColor(activeSession)}
                            size={12}
                          />
                          <SwiftText
                            modifiers={[
                              font({ size: 26, weight: "bold" }),
                              foregroundStyle(themeColors.text),
                            ]}
                          >
                            {activeSession.label}
                          </SwiftText>
                        </HStack>
                        <SwiftText
                          modifiers={[
                            font({ size: 17 }),
                            foregroundStyle(themeColors.text),
                          ]}
                        >
                          {activeSession.username}
                        </SwiftText>
                        <SwiftText
                          modifiers={[
                            font({ size: 15 }),
                            foregroundStyle(themeColors.textMuted),
                          ]}
                        >
                          {activeSession.serverUrl}
                        </SwiftText>
                        {activeSession.needsAttention ? (
                          <SwiftText
                            modifiers={[
                              font({ size: 15, weight: "semibold" }),
                              foregroundStyle(ERROR_COLOR),
                            ]}
                          >
                            Sign in needs attention
                          </SwiftText>
                        ) : null}
                      </VStack>
                      <Spacer />
                      <Image
                        systemName="chevron.right"
                        color={themeColors.textMuted}
                        size={17}
                      />
                    </HStack>
                  </Button>
                </VStack>
              </Section>
            ) : null}

            {otherSessions.length > 0 ? (
              <Section
                header={
                  <SwiftText
                    modifiers={[
                      font({ size: 20, weight: "bold" }),
                      foregroundStyle(themeColors.text),
                    ]}
                  >
                    {activeSession ? "Switch To" : "Sign-Ins"}
                  </SwiftText>
                }
                modifiers={[listRowBackground(themeColors.surface)]}
                footer={
                  <SwiftText modifiers={[font({ size: 14 })]}>
                    {localError ??
                      "Tap to switch. Swipe left to edit or remove."}
                  </SwiftText>
                }
              >
                {otherSessions.map((session) => {
                  const canRestore = canRestoreBySession[session.key];
                  const isSignedOut = canRestore === false;
                  const isPending = pendingSessionKey === session.key;
                  return (
                    <SwipeActions key={session.key}>
                      <Button
                        onPress={() => switchTo(session)}
                        modifiers={[buttonStyle("plain")]}
                      >
                        <HStack
                          spacing={12}
                          alignment="center"
                          modifiers={[padding({ vertical: 4 })]}
                        >
                          <Image
                            systemName="circle.fill"
                            color={sessionColor(session)}
                            size={12}
                          />
                          <VStack alignment="leading" spacing={3}>
                            <SwiftText
                              modifiers={[
                                font({ size: 19, weight: "semibold" }),
                                foregroundStyle(themeColors.text),
                              ]}
                            >
                              {session.label}
                            </SwiftText>
                            <SwiftText
                              modifiers={[
                                font({ size: 15, weight: isSignedOut ? "semibold" : "regular" }),
                                foregroundStyle(
                                  isSignedOut ? WARNING_COLOR : themeColors.text,
                                ),
                              ]}
                            >
                              {isSignedOut
                                ? "Sign in needed"
                                : session.username}
                            </SwiftText>
                            <SwiftText
                              modifiers={[
                                font({ size: 14 }),
                                foregroundStyle(themeColors.textMuted),
                              ]}
                            >
                              {session.serverUrl}
                            </SwiftText>
                            {session.needsAttention ? (
                              <SwiftText
                                modifiers={[
                                  font({ size: 14, weight: "semibold" }),
                                  foregroundStyle(ERROR_COLOR),
                                ]}
                              >
                                Sign in needs attention
                              </SwiftText>
                            ) : null}
                          </VStack>
                          <Spacer />
                          {isPending ? (
                            <ProgressView />
                          ) : (
                            <Image
                              systemName={
                                isSignedOut
                                  ? "lock.fill"
                                  : "arrow.triangle.2.circlepath.circle.fill"
                              }
                              color={
                                isSignedOut
                                  ? themeColors.textMuted
                                  : READY_COLOR
                              }
                              size={26}
                            />
                          )}
                        </HStack>
                      </Button>
                      <SwipeActions.Actions
                        edge="trailing"
                        allowsFullSwipe={false}
                      >
                        <Button
                          label="Remove"
                          systemImage="trash"
                          role="destructive"
                          onPress={() => confirmRemove(session)}
                        />
                        <Button
                          label="Edit"
                          systemImage="pencil"
                          onPress={() => openEdit(session)}
                          modifiers={[buttonStyle("borderedProminent")]}
                        />
                      </SwipeActions.Actions>
                    </SwipeActions>
                  );
                })}
              </Section>
            ) : null}

            <Section
              modifiers={[listRowBackground(themeColors.surface)]}
              footer={
                sortedSessions.length === 0 ? (
                  <SwiftText modifiers={[font({ size: 14 })]}>
                    {localError ??
                      "Add a sign-in to connect to Audiobookshelf."}
                  </SwiftText>
                ) : undefined
              }
            >
              <Button
                label="Add Sign-In"
                systemImage="plus.circle.fill"
                onPress={openAdd}
                modifiers={[
                  buttonStyle("borderless"),
                  font({ size: 18, weight: "semibold" }),
                ]}
              />
            </Section>
          </List>
        </Host>
      ) : null}
    </>
  );
}
