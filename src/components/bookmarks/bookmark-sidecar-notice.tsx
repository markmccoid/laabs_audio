import { useBookmarkSidecarScope } from "@/bookmark-sidecar/use-bookmark-sidecar";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { MenuView } from "@expo/ui/community/menu";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

const durationLabel = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? (formatSeconds(seconds, "compact", true, true) ?? "?") : "unknown";

const countLabel = (count: number) => `${count} bookmark${count === 1 ? "" : "s"}`;

/**
 * Audio Fingerprint mismatch notice for a Bookmark List (ADR 0046). Load anyway
 * merges, Not now pauses syncing, and Replace server bookmarks sits behind a
 * menu and a second confirmation. None of them removes device bookmarks.
 */
export const BookmarkSidecarNotice = ({
  libraryItemId,
  episodeId = null,
}: {
  libraryItemId: string | null | undefined;
  episodeId?: string | null;
}) => {
  const themeColors = useThemeColors();
  const { scopeState, loadAnyway, notNow, replaceServer } = useBookmarkSidecarScope(
    libraryItemId,
    episodeId,
  );
  const [isWorking, setIsWorking] = useState(false);
  if (!scopeState) return null;

  const run = (action: () => Promise<unknown>) => {
    setIsWorking(true);
    void action().finally(() => setIsWorking(false));
  };

  const confirmReplace = () => {
    Alert.alert(
      "Replace server bookmarks?",
      `This permanently replaces the ${countLabel(scopeState.remoteRecordCount)} saved on the server for this ${
        episodeId ? "episode" : "book"
      } with the ${countLabel(scopeState.localRecordCount)} on this device. Bookmarks on this device are not changed.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: () => run(replaceServer) },
      ],
    );
  };

  const isPaused = scopeState.status === "paused";
  const buttonStyle = (primary: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderCurve: "continuous" as const,
    borderWidth: primary ? 0 : 1,
    borderColor: themeColors.border,
    backgroundColor: primary ? themeColors.accent : themeColors.bg,
    opacity: isWorking ? 0.6 : 1,
  });

  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.bg,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <SymbolView
          name="exclamationmark.arrow.triangle.2.circlepath"
          tintColor={themeColors.textMuted}
          size={16}
        />
        <Text selectable style={{ flex: 1, color: themeColors.text, fontSize: 14, lineHeight: 19 }}>
          {isPaused ? "Server bookmark sync is paused. " : ""}
          Server bookmarks were saved for a different version of this audio (was{" "}
          {durationLabel(scopeState.storedFingerprint?.durationSeconds)}, now{" "}
          {durationLabel(scopeState.currentFingerprint?.durationSeconds)}).
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          disabled={isWorking}
          onPress={() => run(loadAnyway)}
          style={buttonStyle(true)}
        >
          <Text style={{ color: themeColors.accentForeground, fontSize: 14, fontWeight: "600" }}>
            Load anyway
          </Text>
        </Pressable>
        {isPaused ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={isWorking}
            onPress={notNow}
            style={buttonStyle(false)}
          >
            <Text style={{ color: themeColors.text, fontSize: 14 }}>Not now</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <MenuView
          title="Server bookmarks"
          actions={[
            {
              id: "replace",
              title: "Replace server bookmarks…",
              image: "arrow.triangle.2.circlepath",
              attributes: { destructive: true, disabled: isWorking },
            },
          ]}
          onPressAction={(event) => {
            if (event.nativeEvent.event === "replace") confirmReplace();
          }}
        >
          <View
            accessibilityRole="button"
            accessibilityLabel="More server bookmark options"
            style={{ padding: 6 }}
          >
            <SymbolView name="ellipsis.circle" tintColor={themeColors.textMuted} size={20} />
          </View>
        </MenuView>
      </View>
    </View>
  );
};
