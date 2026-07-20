import { enterUserSession } from "@/auth/enter-user-session";
import { isConnectionFailureKind } from "@/auth/server-connection";
import { selectAccessMode, useAuthActions, useAuthStore } from "@/auth/auth-store";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import { useExplicitLogout } from "@/auth/use-explicit-logout";
import type { RememberedSessionRecord } from "@/auth/auth-storage";
import { useThemeColors } from "@/theme/use-app-theme";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SessionActionId = "restore" | "edit" | "signOut" | "remove";

const resolveParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const getMenuActions = (options: {
  isActive: boolean;
  hasActiveSession: boolean;
  disabled: boolean;
}): MenuAction[] => {
  const { isActive, hasActiveSession, disabled } = options;
  if (isActive) {
    return [
      { id: "edit", title: "Edit", image: "pencil", attributes: { disabled } },
      {
        id: "signOut",
        title: "Sign Out",
        image: "rectangle.portrait.and.arrow.right",
        attributes: { disabled },
      },
      {
        id: "remove",
        title: "Remove Sign-In",
        image: "trash",
        attributes: { destructive: true, disabled },
      },
    ];
  }

  return [
    {
      id: "restore",
      title: hasActiveSession ? "Switch Sign-In" : "Sign In",
      image: hasActiveSession ? "arrow.triangle.2.circlepath" : "person.crop.circle.badge.checkmark",
      attributes: { disabled },
    },
    { id: "edit", title: "Edit", image: "pencil", attributes: { disabled } },
    {
      id: "remove",
      title: "Remove Sign-In",
      image: "trash",
      attributes: { destructive: true, disabled },
    },
  ];
};

export function SignInListScreen() {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const accessMode = useAuthStore(selectAccessMode);
  const { removeRememberedSession } = useAuthActions();
  const explicitLogout = useExplicitLogout();
  const applyResolution = useApplySessionEntryResolution();
  const params = useLocalSearchParams<{
    mode?: string;
    returnToLibraryItemId?: string | string[];
  }>();
  const mode = typeof params.mode === "string" ? params.mode : "required";
  const returnToLibraryItemId = resolveParam(params.returnToLibraryItemId);
  const [pendingSessionKey, setPendingSessionKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const hasActiveSession = Boolean(activeSessionKey);
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
      const resolution = await enterUserSession({ via: "restore", sessionKey: session.key });
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

  const confirmRemove = (session: RememberedSessionRecord) => {
    const isActive = session.key === activeSessionKey;
    Alert.alert(
      "Remove Sign-In?",
      `Remove ${session.label}? Downloaded audio and listening data stay on this device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setPendingSessionKey(session.key);
              try {
                if (isActive) {
                  await explicitLogout();
                }
                await removeRememberedSession(session.key);
              } finally {
                setPendingSessionKey(null);
              }
            })();
          },
        },
      ],
    );
  };

  const handleMenuAction = (
    event: NativeActionEvent,
    session: RememberedSessionRecord,
  ) => {
    const actionId = event.nativeEvent.event as SessionActionId;
    if (actionId === "restore") {
      void restoreSession(session);
      return;
    }
    if (actionId === "edit") {
      openEdit(session);
      return;
    }
    if (actionId === "signOut") {
      void explicitLogout();
      return;
    }
    if (actionId === "remove") {
      confirmRemove(session);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: Math.max(24, insets.bottom + 16),
          gap: 14,
        }}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            title: "Sign-Ins",
            headerLeft: () =>
              accessMode !== "firstRunSignInRequired" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  onPress={() => router.back()}
                  hitSlop={12}
                  style={{ flexDirection: "row", alignItems: "center", marginLeft: -8, padding: 8 }}
                >
                  <SymbolView name="chevron.left" tintColor={themeColors.accent} size={24} weight="semibold" />
                </Pressable>
              ) : null,
            headerRight: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add Sign-In"
                onPress={openAdd}
                hitSlop={12}
              >
                <SymbolView name="plus" tintColor={themeColors.accent} size={24} />
              </Pressable>
            ),
          }}
        />

        <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
          Choose which Audiobookshelf sign-in to use.
        </Text>

        {localError ? (
          <Text selectable style={{ color: "#dc2626", fontSize: 14 }}>
            {localError}
          </Text>
        ) : null}

        {sortedSessions.length === 0 ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: themeColors.border,
              borderRadius: 14,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              padding: 16,
              gap: 12,
            }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
              No sign-ins saved
            </Text>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14, lineHeight: 20 }}>
              Add a sign-in to connect to Audiobookshelf.
            </Text>
            <Pressable
              onPress={openAdd}
              style={{
                borderRadius: 12,
                borderCurve: "continuous",
                backgroundColor: themeColors.accent,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Text
                style={{
                  color: themeColors.accentForeground,
                  fontSize: 16,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                Add Sign-In
              </Text>
            </Pressable>
          </View>
        ) : (
          sortedSessions.map((session) => {
            const isActive = session.key === activeSessionKey;
            const isPending = pendingSessionKey === session.key;
            const actions = getMenuActions({
              isActive,
              hasActiveSession,
              disabled: Boolean(pendingSessionKey),
            });

            return (
              <MenuView
                key={session.key}
                title={session.label}
                actions={actions}
                onPressAction={(event) => handleMenuAction(event, session)}
                style={{ flex: 1 }}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={`Open actions for ${session.label}`}
                  style={{
                    borderWidth: 1,
                    borderColor: isActive ? "#16a34a" : themeColors.border,
                    borderRadius: 14,
                    borderCurve: "continuous",
                    backgroundColor: themeColors.surface,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, gap: 5, paddingRight: isActive ? 18 : 0 }}>
                    <Text
                      selectable
                      style={{
                        color: themeColors.text,
                        fontSize: 17,
                        fontWeight: "700",
                      }}
                    >
                      {session.label}
                    </Text>
                    <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
                      {session.username}
                    </Text>
                    <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                      {session.serverUrl}
                    </Text>
                    {session.needsAttention ? (
                      <Text selectable style={{ color: "#dc2626", fontSize: 13 }}>
                        Sign in needs attention
                      </Text>
                    ) : null}
                  </View>
                  {isPending ? <ActivityIndicator color={themeColors.accent} /> : null}

                  {isActive && !isPending ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        top: -9,
                        right: -9,
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        backgroundColor: "#16a34a",
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 2,
                        borderColor: themeColors.bg,
                      }}
                    >
                      <SymbolView name="checkmark" tintColor="#fff" size={15} weight="bold" />
                    </View>
                  ) : null}
                </View>
              </MenuView>
            );
          })
        )}

      </ScrollView>
    </View>
  );
}
