import { enterUserSession } from "@/auth/enter-user-session";
import { isConnectionFailureKind } from "@/auth/server-connection";
import { authStorage, getSessionDisplayName, type RememberedSessionRecord } from "@/auth/auth-storage";
import { libraryActivationStore } from "@/auth/library-activation-store";
import { selectActiveLibraryExperience } from "@/auth/active-library-experience";
import { authStore, useAuthStore } from "@/auth/auth-store";
import { replaceAssistantSurfaceContent } from "@/auth/session-boundary";
import { useApplySessionEntryResolution } from "@/auth/use-apply-session-entry-resolution";
import { resolveSessionColor } from "@/auth/session-color";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { homeSessionSwitchStore, useHomeSessionSwitch } from "./home-session-switch-store";

const BUTTON_LABEL_MAX_CHARS = 22;

/**
 * Data + handlers for the Home-header Session Entry Switch. The native
 * Stack.Toolbar primitives are rendered by the Home screen itself (the toolbar
 * only keeps Stack.Toolbar.* children, so a wrapping component would be dropped);
 * this hook owns the session list and the switch behavior.
 *
 * Picking another session runs the shared enterUserSession restore path. Failure
 * mirrors the Sign-In list screen: credential failures open that session's edit
 * form, while connection failures / no-libraries surface an Alert. Home keeps
 * a pending label and loading transition until the selected library is ready.
 */
export const useHomeSignInSwitcher = () => {
  const storedUsername = useAuthStore((state) => state.storedUsername);
  const activeSessionKey = useAuthStore((state) => state.activeSessionKey);
  const pendingSessionKey = useHomeSessionSwitch((state) => state.pendingSessionKey);
  const sessions = useAuthStore((state) => state.rememberedSessions);
  const applyResolution = useApplySessionEntryResolution();
  const themeColors = useThemeColors();
  const { theme } = useUniwind();
  const scheme = theme === "dark" ? "dark" : "light";
  const pendingRef = useRef(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.key === (pendingSessionKey ?? activeSessionKey)) ?? null,
    [activeSessionKey, pendingSessionKey, sessions],
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
        .filter((session) => session.key !== (pendingSessionKey ?? activeSessionKey))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [activeSessionKey, pendingSessionKey, sessions],
  );

  const switchTo = useCallback(
    async (session: RememberedSessionRecord) => {
      if (pendingRef.current || homeSessionSwitchStore.getState().pendingSessionKey) return;
      pendingRef.current = true;
      const previous = authStore.getState();
      const previousExperience = selectActiveLibraryExperience(previous);
      homeSessionSwitchStore.getState().actions.start(
        session.key,
        previousExperience === "unresolved" ? null : previousExperience,
      );
      const restorePreviousSession = async () => {
        if (!previous.activeSessionKey || authStore.getState().activeSessionKey !== session.key) return;
        const secrets = previous.accessToken && previous.refreshToken
          ? null
          : await authStorage.getSessionSecrets(previous.activeSessionKey);
        const accessToken = previous.accessToken ?? secrets?.accessToken;
        const refreshToken = previous.refreshToken ?? secrets?.refreshToken;
        if (!accessToken || !refreshToken) return;

        authStore.getState().actions.commitActiveSession(previous.activeSessionKey, {
          accessToken,
          refreshToken,
          hasPassword: previous.hasStoredCredentials,
        });
        authStore.getState().actions.setServerConnectionStatus(previous.serverConnectionStatus);
        if (previous.storedUserId) {
          await replaceAssistantSurfaceContent(previous.storedUserId, previous.activeLibraryId);
        }
      };
      let waitingForHomeContent = false;
      try {
        const resolution = await enterUserSession({ via: "restore", sessionKey: session.key });
        // Authentication can succeed while library resolution fails. Restore the
        // previous session in that case so Home returns to its prior library.
        if (
          (resolution.outcome === "failed" || resolution.outcome === "noLibraries") &&
          previous.activeSessionKey !== session.key
        ) {
          await restorePreviousSession();
        }
        await applyResolution(resolution, {
          stayOnHome: true,
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
        if (
          resolution.outcome === "activate" &&
          libraryActivationStore.getState().status === "failed"
        ) {
          const message = libraryActivationStore.getState().errorMessage ?? "Could not load library.";
          await restorePreviousSession();
          libraryActivationStore.getState().actions.clear();
          Alert.alert("Could not switch sign-in", message);
          return;
        }
        if (
          resolution.outcome === "activate" &&
          libraryActivationStore.getState().status === "idle"
        ) {
          homeSessionSwitchStore.getState().actions.resolveEntry();
          waitingForHomeContent = true;
        }
      } catch (error) {
        Alert.alert("Could not switch sign-in", error instanceof Error ? error.message : "Try again.");
      } finally {
        if (!waitingForHomeContent) homeSessionSwitchStore.getState().actions.clear();
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
