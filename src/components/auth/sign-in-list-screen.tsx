import { prepareForSignInChange } from "@/auth/session-boundary";
import { selectAccessMode, useAuthActions, useAuthStore } from "@/auth/auth-store";
import { useCompleteSessionEntry } from "@/auth/use-complete-session-entry";
import { useExplicitLogout } from "@/auth/use-explicit-logout";
import type { RememberedSessionRecord } from "@/auth/auth-storage";
import { useThemeColors } from "@/theme/use-app-theme";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import { router, useLocalSearchParams } from "expo-router";
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
  const storedUserId = useAuthStore((state) => state.storedUserId);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const accessMode = useAuthStore(selectAccessMode);
  const isOnline = useAuthStore((state) => state.isOnline);
  const { restoreRememberedSession, removeRememberedSession } = useAuthActions();
  const explicitLogout = useExplicitLogout();
  const completeSessionEntry = useCompleteSessionEntry();
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
    if (isOnline === false) {
      setLocalError("You are offline. Connect to the internet to sign in.");
      return;
    }

    setLocalError(null);
    setPendingSessionKey(session.key);
    try {
      const isSameUserSwitch = Boolean(storedUserId && storedUserId === session.userId);
      await prepareForSignInChange({ userId: session.userId, sessionKey: session.key });
      await restoreRememberedSession(session.key);
      await completeSessionEntry({
        mode,
        returnToLibraryItemId,
        activeLibraryId: session.activeLibraryId ?? (isSameUserSwitch ? activeLibraryId : null),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed";
      setLocalError(message);
      if (!message.toLowerCase().includes("offline")) {
        openEdit(session);
      }
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text selectable style={{ color: themeColors.text, fontSize: 28, fontWeight: "700" }}>
              Sign-Ins
            </Text>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14, marginTop: 4 }}>
              Choose which Audiobookshelf sign-in to use.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add Sign-In"
            onPress={openAdd}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: themeColors.accent,
            }}
          >
            <SymbolView name="plus" tintColor={themeColors.accentForeground} size={20} />
          </Pressable>
        </View>

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
                    borderColor: themeColors.border,
                    borderRadius: 14,
                    borderCurve: "continuous",
                    backgroundColor: themeColors.surface,
                    paddingLeft: 14,
                    paddingRight: 14,
                    paddingVertical: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    overflow: "hidden",
                  }}
                >
                  {isActive ? (
                    <View
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 5,
                        backgroundColor: "#166534",
                      }}
                    />
                  ) : null}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      selectable
                      style={{
                        color: themeColors.text,
                        fontSize: 17,
                        fontWeight: "700",
                        flexShrink: 1,
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
                  {isPending ? (
                    <ActivityIndicator color={themeColors.accent} />
                  ) : isActive ? (
                    <View
                      style={{
                        borderRadius: 999,
                        backgroundColor: "#16a34a",
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                      }}
                    >
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                        Active
                      </Text>
                    </View>
                  ) : null}
                </View>
              </MenuView>
            );
          })
        )}

        {accessMode !== "firstRunSignInRequired" ? (
          <Pressable
            onPress={() => router.back()}
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: themeColors.text, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
              Done
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
