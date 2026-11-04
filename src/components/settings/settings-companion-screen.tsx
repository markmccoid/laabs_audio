import { useAuthStore } from "@/auth/auth-store";
import {
  EMPTY_COMPANION_ENDPOINT,
  useBookmarkSidecarStore,
} from "@/bookmark-sidecar/bookmark-sidecar-store";
import { conventionalCompanionUrl } from "@/bookmark-sidecar/companion-client";
import {
  backfillUser,
  flushBookmarkSidecars,
  resolveCompanion,
  setManualCompanionUrl,
} from "@/bookmark-sidecar/sidecar-sync";
import { CompanionSyncList } from "@/components/settings/companion-sync-list";
import { useThemeColors } from "@/theme/use-app-theme";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

/**
 * Settings → LAABS Companion (ADR 0046). The endpoint is stored per
 * Remembered User Session; without a Companion LAABS Audio stays local-only.
 */
export const SettingsCompanionScreen = () => {
  const themeColors = useThemeColors();
  const sessionKey = useAuthStore((state) => state.activeSessionKey);
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const userKey = useAuthStore((state) => state.storedUserId?.trim() || null);
  const endpoint = useBookmarkSidecarStore((state) =>
    sessionKey ? (state.companionBySession[sessionKey] ?? EMPTY_COMPANION_ENDPOINT) : EMPTY_COMPANION_ENDPOINT,
  );
  const dirtyCount = useBookmarkSidecarStore((state) =>
    userKey ? Object.keys(state.dirtyItemsByUser[userKey] ?? {}).length : 0,
  );
  const [manualUrl, setManualUrl] = useState(endpoint.manualUrl ?? "");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    void resolveCompanion();
  }, [sessionKey]);

  const run = (action: () => Promise<unknown>) => {
    setIsWorking(true);
    void action().finally(() => setIsWorking(false));
  };

  const statusLabel =
    endpoint.status === "available"
      ? "Connected"
      : endpoint.status === "unavailable"
        ? "Not found"
        : "Not checked yet";
  const fallbackUrl = serverUrl ? conventionalCompanionUrl(serverUrl) : "";

  const buttonStyle = {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: themeColors.border,
    backgroundColor: themeColors.surface,
    opacity: isWorking ? 0.6 : 1,
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 16 }}
      style={{ backgroundColor: themeColors.bg }}
    >
      <Text selectable style={{ color: themeColors.textMuted, fontSize: 14, lineHeight: 20 }}>
        A LAABS Companion is an optional service that runs beside your Audiobookshelf server and
        saves your bookmarks and clips in each book&apos;s folder, so they sync between devices and
        survive an Audiobookshelf reset. Without one, bookmarks stay on this device.
      </Text>

      <View
        style={{
          gap: 6,
          padding: 14,
          borderRadius: 12,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}>
            {statusLabel}
          </Text>
          {isWorking ? <ActivityIndicator size="small" /> : null}
        </View>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          {endpoint.resolvedUrl ?? endpoint.manualUrl ?? fallbackUrl}
        </Text>
        {endpoint.status === "available" && dirtyCount > 0 ? (
          <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {dirtyCount} item{dirtyCount === 1 ? "" : "s"} waiting to sync
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "500" }}>
          Companion URL
        </Text>
        <TextInput
          value={manualUrl}
          onChangeText={setManualUrl}
          placeholder={fallbackUrl || "https://abs.example.com/laabs"}
          placeholderTextColor={themeColors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{
            color: themeColors.text,
            fontSize: 15,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
          }}
        />
        <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
          Leave empty to look for it at your server address followed by /laabs.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          disabled={isWorking}
          onPress={() => run(() => setManualCompanionUrl(manualUrl))}
          style={buttonStyle}
        >
          <Text style={{ color: themeColors.text, fontSize: 15 }}>Save and check</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isWorking || endpoint.status !== "available" || !userKey}
          onPress={() =>
            run(async () => {
              if (userKey) backfillUser(userKey);
              await flushBookmarkSidecars();
            })
          }
          style={[buttonStyle, { opacity: endpoint.status === "available" && !isWorking ? 1 : 0.5 }]}
        >
          <Text style={{ color: themeColors.text, fontSize: 15 }}>Sync all bookmarks now</Text>
        </Pressable>
      </View>

      {endpoint.status === "available" ? <CompanionSyncList userKey={userKey} /> : null}
    </ScrollView>
  );
};
