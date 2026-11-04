import { syncBookmarkSidecar } from "@/bookmark-sidecar/sidecar-sync";
import type {
  SidecarSyncItemRow,
  SidecarSyncItemStatus,
} from "@/bookmark-sidecar/sidecar-sync-status";
import { useSidecarSyncRows } from "@/bookmark-sidecar/use-sidecar-sync-status";
import { useThemeColors } from "@/theme/use-app-theme";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

const STATUS_LABEL: Record<SidecarSyncItemStatus, string> = {
  error: "Failed",
  attention: "Needs you",
  waiting: "Waiting",
  synced: "Synced",
};

const STATUS_COLORS: Record<
  SidecarSyncItemStatus,
  { backgroundColor: string; borderColor: string; textColor: string }
> = {
  error: { backgroundColor: "#fee2e2", borderColor: "#fca5a5", textColor: "#b91c1c" },
  attention: { backgroundColor: "#fef3c7", borderColor: "#fcd34d", textColor: "#b45309" },
  waiting: { backgroundColor: "#dbeafe", borderColor: "#93c5fd", textColor: "#1d4ed8" },
  synced: { backgroundColor: "#dcfce7", borderColor: "#86efac", textColor: "#15803d" },
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const SyncRow = ({ row }: { row: SidecarSyncItemRow }) => {
  const themeColors = useThemeColors();
  const [isRetrying, setIsRetrying] = useState(false);
  const colors = STATUS_COLORS[row.status];
  const canRetry = row.status === "error" || row.status === "waiting";

  const retry = () => {
    setIsRetrying(true);
    void syncBookmarkSidecar(row.libraryItemId).finally(() => setIsRetrying(false));
  };

  return (
    <View
      style={{
        gap: 4,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: themeColors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: themeColors.text, fontSize: 15, fontWeight: "500" }}
        >
          {row.title ?? "Unknown title"}
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundColor,
          }}
        >
          <Text style={{ color: colors.textColor, fontSize: 12, fontWeight: "600" }}>
            {STATUS_LABEL[row.status]}
          </Text>
        </View>
      </View>
      <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
        {row.media === "podcast" ? "Podcast · " : ""}
        {row.bookmarkCount > 0
          ? `${plural(row.bookmarkCount, "bookmark")} on this device`
          : "Deletions waiting to upload"}
        {row.title ? "" : ` · ${row.libraryItemId}`}
      </Text>
      {row.detail ? (
        <Text
          selectable
          style={{
            color: row.status === "error" ? colors.textColor : themeColors.textMuted,
            fontSize: 13,
          }}
        >
          {row.detail}
        </Text>
      ) : null}
      {canRetry ? (
        <Pressable
          accessibilityRole="button"
          disabled={isRetrying}
          onPress={retry}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}
        >
          <Text style={{ color: themeColors.accent, fontSize: 14, fontWeight: "500" }}>
            {row.status === "error" ? "Retry" : "Sync now"}
          </Text>
          {isRetrying ? <ActivityIndicator size="small" /> : null}
        </Pressable>
      ) : null}
    </View>
  );
};

/** Settings → LAABS Companion: what this device has to sync, item by item (ADR 0046). */
export const CompanionSyncList = ({ userKey }: { userKey: string | null }) => {
  const themeColors = useThemeColors();
  const rows = useSidecarSyncRows(userKey);
  const [showSynced, setShowSynced] = useState(false);

  if (!rows.length) {
    return (
      <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>
        No bookmarks on this device yet.
      </Text>
    );
  }

  const pending = rows.filter((row) => row.status !== "synced");
  const synced = rows.filter((row) => row.status === "synced");
  const tally = (status: SidecarSyncItemStatus) => rows.filter((row) => row.status === status).length;
  const summary = [
    tally("error") ? `${tally("error")} failed` : null,
    tally("attention") ? `${tally("attention")} need you` : null,
    tally("waiting") ? `${tally("waiting")} waiting` : null,
    `${synced.length} synced`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 4,
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
      }}
    >
      <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
        Bookmarks on this device
      </Text>
      <Text style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 2, marginBottom: 10 }}>
        {summary}
      </Text>
      {pending.map((row) => (
        <SyncRow key={row.libraryItemId} row={row} />
      ))}
      {synced.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowSynced((current) => !current)}
          style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.border }}
        >
          <Text style={{ color: themeColors.accent, fontSize: 14, fontWeight: "500" }}>
            {showSynced ? "Hide synced items" : `Show ${plural(synced.length, "synced item")}`}
          </Text>
        </Pressable>
      ) : null}
      {showSynced ? synced.map((row) => <SyncRow key={row.libraryItemId} row={row} />) : null}
    </View>
  );
};
