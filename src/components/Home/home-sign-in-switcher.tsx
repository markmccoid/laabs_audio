import { enterUserSession } from "@/auth/enter-user-session";
import { isConnectionFailureKind } from "@/auth/server-connection";
import { getSessionDisplayName, type RememberedSessionRecord } from "@/auth/auth-storage";
import { useAuthStore } from "@/auth/auth-store";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import { resolveSessionColor } from "@/auth/session-color";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";

const BUTTON_LABEL_MAX_CHARS = 22;

/**
 * Data + handlers for the Home-header Session Entry Switch. The native
 * Stack.Toolbar primitives are rendered by the Home screen itself (the toolbar
 * only keeps Stack.Toolbar.* children, so a wrapping component would be dropped);
 * this hook owns the session list and the switch behavior.
 *
 * Picking another session runs the shared enterUserSession restore path. Failure
 * mirrors the Sign-In list screen: credential failures open that session's edit
 * form, while connection failures / no-libraries surface an Alert. Success rides
 * Home's existing Library Activation loading.
 */
export const useHomeSignInSwitcher = () => {
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const applyResolution = useApplySessionEntryResolution();
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const scheme = theme === "dark" ? "dark" : "light";
  const pendingRef = useRef(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.key === activeSessionKey) ?? null,
    [activeSessionKey, sessions],
  );

  const activeColor = useMemo(
    () => (activeSession ? resolveSessionColor(activeSession, scheme, themeColors.bg) : undefined),
    [activeSession, scheme, themeColors.bg],
  );

  // Show the custom label when the user set one, otherwise the username; capped so a long
  // label can't blow out the header bar.
  const buttonLabel = useMemo(() => {
    const name = activeSession ? getSessionDisplayName(activeSession) : (storedUsername ?? "");
    return name.length > BUTTON_LABEL_MAX_CHARS
      ? `${name.slice(0, BUTTON_LABEL_MAX_CHARS - 1).trimEnd()}…`
      : name;
  }, [activeSession, storedUsername]);

  const otherSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.key !== activeSessionKey)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [activeSessionKey, sessions],
  );

  const switchTo = useCallback(
    async (session: RememberedSessionRecord) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      try {
        const resolution = await enterUserSession({ via: "restore", sessionKey: session.key });
        await applyResolution(resolution, {
          onError: (message) => {
            if (resolution.outcome === "noLibraries") {
              Alert.alert("No libraries available", message);
            }
          },
          onFailed: (failure) => {
            if (isConnectionFailureKind(failure.kind)) {
              Alert.alert(
                failure.kind === "offline" ? "You're offline" : "Audiobookshelf unavailable",
                failure.message,
              );
              return;
            }
            router.push({
              pathname: "/login/edit",
              params: { sessionKey: session.key },
            } as never);
          },
        });
      } finally {
        pendingRef.current = false;
      }
    },
    [applyResolution],
  );

  const openAdd = useCallback(() => {
    router.push("/login/add" as never);
  }, []);

  const openManage = useCallback(() => {
    router.push("/login");
  }, []);

  return {
    storedUsername,
    buttonLabel,
    activeSession,
    activeColor,
    otherSessions,
    switchTo,
    openAdd,
    openManage,
  };
};
