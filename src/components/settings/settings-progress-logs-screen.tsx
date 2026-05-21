import {
  type ProgressLogEntry,
  type ProgressLogEventType,
  type ProgressLogSessionKind,
  useProgressLogActions,
  useProgressLogStore,
} from "@/store/progress-log-store";
import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { useHeaderHeight } from "@react-navigation/elements";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { SymbolView } from "expo-symbols";
import { useDeferredValue, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { toast } from "react-native-sonner";

type EventTypeFilter = ProgressLogEventType | "all";
type SessionKindFilter = ProgressLogSessionKind | "all";

type FilterChipProps<T extends string> = {
  label: string;
  value: T;
  selectedValue: T;
  onPress: (value: T) => void;
};

const sanitizeFileSegment = (value: string) =>
  value
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "logs";

const formatTimestamp = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));

const formatSeconds = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "none";
  }

  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
};

const formatSessionKind = (sessionKind: ProgressLogSessionKind) =>
  sessionKind === "downloaded" ? "Downloaded" : sessionKind === "streamed" ? "Streamed" : "Unknown";

const formatEventTypeLabel = (eventType: ProgressLogEventType) =>
  eventType === "progress_sync_point"
    ? "Sync Point"
    : eventType === "progress_resolution"
      ? "Progress Choice"
      : eventType === "server_progress_fetch"
        ? "Server Fetch"
        : eventType === "playback_state_transition"
          ? "Playback State"
          : eventType === "clip_transcript_export"
            ? "Transcript Export"
            : "Queue Sync";

const getEventBadgeColors = (
  themeColors: ReturnType<typeof useThemeColors>,
  eventType: ProgressLogEventType,
) => {
  switch (eventType) {
    case "progress_sync_point":
      return {
        backgroundColor: "#dbeafe",
        borderColor: "#93c5fd",
        textColor: "#1d4ed8",
      };
    case "progress_resolution":
      return {
        backgroundColor: "#dcfce7",
        borderColor: "#86efac",
        textColor: "#15803d",
      };
    case "server_progress_fetch":
      return {
        backgroundColor: "#ede9fe",
        borderColor: "#c4b5fd",
        textColor: "#6d28d9",
      };
    case "playback_state_transition":
      return {
        backgroundColor: "#e0f2fe",
        borderColor: "#7dd3fc",
        textColor: "#0369a1",
      };
    case "clip_transcript_export":
      return {
        backgroundColor: "#fee2e2",
        borderColor: "#fca5a5",
        textColor: "#b91c1c",
      };
    case "queue_sync":
    default:
      return {
        backgroundColor: "#fef3c7",
        borderColor: "#fcd34d",
        textColor: "#b45309",
      };
  }
};

const getStatusBadgeColors = (
  status: "good" | "warning" | "info" | "neutral" | "error",
) => {
  switch (status) {
    case "good":
      return {
        backgroundColor: "#dcfce7",
        borderColor: "#86efac",
        textColor: "#15803d",
      };
    case "warning":
      return {
        backgroundColor: "#fef3c7",
        borderColor: "#fcd34d",
        textColor: "#b45309",
      };
    case "info":
      return {
        backgroundColor: "#dbeafe",
        borderColor: "#93c5fd",
        textColor: "#1d4ed8",
      };
    case "error":
      return {
        backgroundColor: "#fee2e2",
        borderColor: "#fca5a5",
        textColor: "#b91c1c",
      };
    case "neutral":
    default:
      return {
        backgroundColor: "#e5e7eb",
        borderColor: "#d1d5db",
        textColor: "#374151",
      };
  }
};

const FilterChip = <T extends string>({
  label,
  value,
  selectedValue,
  onPress,
}: FilterChipProps<T>) => {
  const themeColors = useThemeColors();
  const selected = value === selectedValue;

  return (
    <Pressable
      onPress={() => onPress(value)}
      style={({ pressed }) => ({
        minHeight: 34,
        borderRadius: 999,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: selected ? themeColors.accent : themeColors.border,
        backgroundColor: selected ? themeColors.accent : themeColors.bg,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <Text
        selectable
        style={{
          color: selected ? themeColors.accentForeground : themeColors.text,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

const DetailLine = ({ label, value }: { label: string; value: string }) => {
  const themeColors = useThemeColors();

  return (
    <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, lineHeight: 18 }}>
      <Text style={{ color: themeColors.text, fontWeight: "600" }}>{label}: </Text>
      {value}
    </Text>
  );
};

const StatusBadge = ({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warning" | "info" | "neutral" | "error";
}) => {
  const colors = getStatusBadgeColors(tone);

  return (
    <View
      style={{
        minHeight: 28,
        borderRadius: 999,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.borderColor,
        backgroundColor: colors.backgroundColor,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text selectable style={{ color: colors.textColor, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
    </View>
  );
};

const LogCard = ({ entry }: { entry: ProgressLogEntry }) => {
  const themeColors = useThemeColors();
  const eventBadgeColors = getEventBadgeColors(themeColors, entry.eventType);

  const statusBadges = (() => {
    if (entry.eventType === "progress_sync_point") {
      return [
        <StatusBadge
          key={`${entry.id}-outcome`}
          label={
            entry.outcome === "synced_to_server"
              ? "Synced"
              : entry.outcome === "queued_after_error"
                ? "Queued After Error"
                : "Queued Offline"
          }
          tone={
            entry.outcome === "synced_to_server"
              ? "good"
              : entry.outcome === "queued_after_error"
                ? "error"
                : "warning"
          }
        />,
        <StatusBadge
          key={`${entry.id}-path`}
          label={
            entry.syncPath === "session_sync"
              ? "Session Sync"
              : entry.syncPath === "direct_progress_update"
                ? "Direct Update"
                : entry.syncPath === "session_sync_then_direct_progress_update"
                  ? "Session Fallback"
                  : "Queue Only"
          }
          tone={
            entry.syncPath === "session_sync"
              ? "info"
              : entry.syncPath === "direct_progress_update"
                ? "neutral"
                : entry.syncPath === "session_sync_then_direct_progress_update"
                  ? "warning"
                  : "warning"
          }
        />,
      ];
    }

    if (entry.eventType === "progress_resolution") {
      return [
        <StatusBadge
          key={`${entry.id}-chosen`}
          label={
            entry.chosenSource === "queue"
              ? "Queue Chosen"
              : entry.chosenSource === "fresh_server_fetch"
                ? "Fresh Server"
                : entry.chosenSource === "persisted_query_cache"
                  ? "Query Cache"
                : entry.chosenSource === "persisted_playback"
                  ? "Persisted Chosen"
                  : "No Progress"
          }
          tone={
            entry.chosenSource === "queue"
              ? "warning"
              : entry.chosenSource === "fresh_server_fetch"
                ? "info"
                : entry.chosenSource === "persisted_query_cache"
                  ? "good"
                : entry.chosenSource === "persisted_playback"
                  ? "good"
                  : "neutral"
          }
        />,
      ];
    }

    if (entry.eventType === "server_progress_fetch") {
      return [
        <StatusBadge
          key={`${entry.id}-fetch-result`}
          label={
            entry.result === "applied"
              ? "Applied"
              : entry.result === "ignored_as_stale"
                ? "Ignored As Stale"
                : entry.result === "timed_out"
                  ? "Timed Out"
                  : "Fetch Failed"
          }
          tone={
            entry.result === "applied"
              ? "good"
              : entry.result === "ignored_as_stale"
                ? "warning"
                : entry.result === "timed_out"
                  ? "warning"
                  : "error"
          }
        />,
      ];
    }

    if (entry.eventType === "playback_state_transition") {
      return [
        <StatusBadge
          key={`${entry.id}-transition`}
          label={`${entry.fromPlaybackState} -> ${entry.toPlaybackState}`}
          tone={entry.toPlaybackState === "playing" ? "good" : "info"}
        />,
        <StatusBadge
          key={`${entry.id}-sync`}
          label={
            entry.syncAttempted
              ? "Sync Attempted"
              : entry.dedupeSkipped
                ? "Sync Deduped"
                : "No Sync"
          }
          tone={entry.syncAttempted ? "warning" : entry.dedupeSkipped ? "neutral" : "info"}
        />,
      ];
    }

    if (entry.eventType === "clip_transcript_export") {
      return [
        <StatusBadge
          key={`${entry.id}-result`}
          label="Transcript Failed"
          tone="error"
        />,
        <StatusBadge
          key={`${entry.id}-stage`}
          label={entry.stage}
          tone="warning"
        />,
      ];
    }

    return [
      <StatusBadge
        key={`${entry.id}-action`}
        label={
          entry.action === "queued"
            ? "Queued"
            : entry.action === "flush_succeeded"
              ? "Flushed"
              : entry.action === "flush_failed"
                ? "Flush Failed"
                : "Flush Skipped"
        }
        tone={
          entry.action === "flush_succeeded"
            ? "good"
            : entry.action === "flush_failed"
              ? "error"
              : entry.action === "flush_skipped"
                ? "warning"
                : "warning"
        }
      />,
    ];
  })();

  const detailLines = (() => {
    if (entry.eventType === "progress_sync_point") {
      return [
        `trigger=${entry.trigger}`,
        `path=${entry.syncPath}`,
        `outcome=${entry.outcome}`,
        `current=${formatSeconds(entry.currentTimeSeconds)} / duration=${formatSeconds(entry.durationSeconds)}`,
        `queuedBacklog=${entry.hadQueuedProgress ? "yes" : "no"} | online=${entry.online ? "yes" : "no"} | authed=${entry.authenticated ? "yes" : "no"}`,
        entry.errorMessage ? `error=${entry.errorMessage}` : null,
      ].filter((value): value is string => Boolean(value));
    }

    if (entry.eventType === "progress_resolution") {
      const candidateSummary = entry.candidates
        .map((candidate) => {
          const time = formatSeconds(candidate.currentTimeSeconds);
          const update = candidate.lastUpdate ? formatTimestamp(candidate.lastUpdate) : "n/a";
          return `${candidate.source}=${time} (available=${candidate.available ? "yes" : "no"}, updated=${update})`;
        })
        .join(" | ");
      return [
        `trigger=${entry.trigger}`,
        `chosen=${entry.chosenSource} @ ${formatSeconds(entry.chosenCurrentTimeSeconds)}`,
        `serverState=${entry.serverStateSource}`,
        `reason=${entry.reason}`,
        candidateSummary,
      ];
    }

    if (entry.eventType === "server_progress_fetch") {
      return [
        `trigger=${entry.trigger}`,
        `result=${entry.result}`,
        `fetched=${formatSeconds(entry.fetchedCurrentTimeSeconds)} | cached=${formatSeconds(entry.cachedCurrentTimeSeconds)}`,
        `fetchedLastUpdate=${entry.fetchedLastUpdate ? formatTimestamp(entry.fetchedLastUpdate) : "n/a"} | cachedLastUpdate=${entry.cachedLastUpdate ? formatTimestamp(entry.cachedLastUpdate) : "n/a"}`,
        entry.note ? `note=${entry.note}` : null,
        entry.errorMessage ? `error=${entry.errorMessage}` : null,
      ].filter((value): value is string => Boolean(value));
    }

    if (entry.eventType === "playback_state_transition") {
      return [
        `trigger=${entry.trigger}`,
        `from=${entry.fromPlaybackState} | to=${entry.toPlaybackState} | enginePlaying=${entry.engineIsPlaying ? "yes" : "no"}`,
        `position=${formatSeconds(entry.positionSeconds)} | track=${formatSeconds(entry.trackPositionSeconds)} | duration=${formatSeconds(entry.durationSeconds)}`,
        `syncAttempted=${entry.syncAttempted ? "yes" : "no"} | syncReason=${entry.syncReason ?? "none"} | dedupeSkipped=${entry.dedupeSkipped ? "yes" : "no"}`,
        entry.note ? `note=${entry.note}` : null,
      ].filter((value): value is string => Boolean(value));
    }

    if (entry.eventType === "clip_transcript_export") {
      return [
        `trigger=${entry.trigger}`,
        `stage=${entry.stage} | platform=${entry.platform}`,
        `bookmark=${entry.bookmarkTitle ?? "none"} | bookmarkId=${entry.bookmarkId ?? "none"}`,
        `range=${formatSeconds(entry.clipStartSeconds)} -> ${formatSeconds(entry.clipEndSeconds)}`,
        entry.errorCode ? `code=${entry.errorCode}` : null,
        entry.errorName ? `name=${entry.errorName}` : null,
        `error=${entry.errorMessage}`,
      ].filter((value): value is string => Boolean(value));
    }

    return [
      `trigger=${entry.trigger}`,
      `action=${entry.action}`,
      `current=${formatSeconds(entry.currentTimeSeconds)} | finished=${entry.isFinished ? "yes" : "no"}`,
      `queueSize=${entry.queueSizeForUser}`,
      entry.originTrigger ? `origin=${entry.originTrigger}` : null,
      entry.note ? `note=${entry.note}` : null,
      entry.errorMessage ? `error=${entry.errorMessage}` : null,
    ].filter((value): value is string => Boolean(value));
  })();

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: themeColors.border,
        borderRadius: 16,
        borderCurve: "continuous",
        backgroundColor: themeColors.surface,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            minHeight: 28,
            borderRadius: 999,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: eventBadgeColors.borderColor,
            backgroundColor: eventBadgeColors.backgroundColor,
            paddingHorizontal: 10,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            selectable
            style={{ color: eventBadgeColors.textColor, fontSize: 12, fontWeight: "700" }}
          >
            {formatEventTypeLabel(entry.eventType)}
          </Text>
        </View>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
          {formatTimestamp(entry.timestamp)}
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{statusBadges}</View>

      <View style={{ gap: 3 }}>
        <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
          {entry.title || "Unknown Book"}
        </Text>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
          {entry.libraryItemId || "No library item id"} · {formatSessionKind(entry.sessionKind)}
        </Text>
      </View>

      <View style={{ gap: 4 }}>
        {detailLines.map((line) => (
          <DetailLine key={`${entry.id}-${line}`} label="Detail" value={line} />
        ))}
      </View>
    </View>
  );
};

export const SettingsProgressLogsScreen = () => {
  const themeColors = useThemeColors();
  const entries = useProgressLogStore((state) => state.entries);
  const progressLoggingEnabled = useSettingsStore((state) => state.progressLoggingEnabled);
  const { clearEntries } = useProgressLogActions();
  const { setProgressLoggingEnabled } = useSettingsActions();
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("all");
  const [sessionKindFilter, setSessionKindFilter] = useState<SessionKindFilter>("all");
  const [searchText, setSearchText] = useState("");
  const deferredSearchText = useDeferredValue(searchText.trim().toLowerCase());
  const [isExporting, setIsExporting] = useState(false);

  const filteredEntries = useMemo(() => {
    const source = [...entries].reverse();
    return source.filter((entry) => {
      if (eventTypeFilter !== "all" && entry.eventType !== eventTypeFilter) {
        return false;
      }

      if (sessionKindFilter !== "all" && entry.sessionKind !== sessionKindFilter) {
        return false;
      }

      if (!deferredSearchText) {
        return true;
      }

      const haystack = [
        entry.title ?? "",
        entry.libraryItemId ?? "",
        entry.eventType,
        entry.trigger,
        entry.sessionKind,
        entry.eventType === "progress_sync_point"
          ? `${entry.syncPath} ${entry.outcome}`
          : entry.eventType === "progress_resolution"
            ? `${entry.chosenSource} ${entry.reason} ${entry.serverStateSource}`
            : entry.eventType === "server_progress_fetch"
              ? `${entry.result} ${entry.note ?? ""} ${entry.errorMessage ?? ""}`
              : entry.eventType === "playback_state_transition"
                ? `${entry.fromPlaybackState} ${entry.toPlaybackState} ${entry.syncReason ?? ""} ${entry.note ?? ""}`
                : entry.eventType === "clip_transcript_export"
                  ? `${entry.result} ${entry.stage} ${entry.bookmarkTitle ?? ""} ${entry.errorCode ?? ""} ${entry.errorName ?? ""} ${entry.errorMessage}`
                : `${entry.action} ${entry.originTrigger ?? ""} ${entry.note ?? ""} ${entry.errorMessage ?? ""}`,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(deferredSearchText);
    });
  }, [deferredSearchText, entries, eventTypeFilter, sessionKindFilter]);

  const exportLogs = async () => {
    if (isExporting) return;
    if (!filteredEntries.length) {
      toast.info("No logs match the current filters");
      return;
    }

    let exportFileUri: string | null = null;
    setIsExporting(true);

    try {
      if (!FileSystem.cacheDirectory) {
        throw new Error("Cache directory is unavailable");
      }

      const exportDirectory = `${FileSystem.cacheDirectory}progress_log_exports/`;
      await FileSystem.makeDirectoryAsync(exportDirectory, { intermediates: true });

      const filterSuffix = sanitizeFileSegment(
        `${eventTypeFilter}-${sessionKindFilter}-${deferredSearchText || "all"}`,
      );
      exportFileUri = `${exportDirectory}progress-logs-${filterSuffix}.json`;

      const payload = {
        exportedAt: new Date().toISOString(),
        filters: {
          eventType: eventTypeFilter,
          sessionKind: sessionKindFilter,
          searchText: deferredSearchText,
        },
        entryCount: filteredEntries.length,
        entries: filteredEntries,
      };

      await FileSystem.writeAsStringAsync(exportFileUri, JSON.stringify(payload, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        toast.info("Sharing is not available on this device");
        return;
      }

      await Sharing.shareAsync(exportFileUri, {
        dialogTitle: "Export progress logs",
        mimeType: "application/json",
        UTI: "public.json",
      });
    } catch (error) {
      console.warn("[SettingsProgressLogsScreen] Export failed", error);
      toast.error("Unable to export logs");
    } finally {
      setIsExporting(false);
      if (exportFileUri) {
        try {
          const info = await FileSystem.getInfoAsync(exportFileUri);
          if (info.exists) {
            await FileSystem.deleteAsync(exportFileUri);
          }
        } catch {
          // Ignore temp file cleanup issues.
        }
      }
    }
  };

  const confirmClearLogs = () => {
    if (!entries.length) {
      toast.info("There are no logs to clear");
      return;
    }

    Alert.alert("Clear Progress Logs", "Delete all saved progress logs from this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearEntries();
          toast.success("Progress logs cleared");
        },
      },
    ]);
  };
  const headerHeight = useHeaderHeight();
  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <FlatList
        data={filteredEntries}
        contentOffset={{ x: 0, y: headerHeight }}
        contentInset={{ top: headerHeight }}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 14 }}>
            <View
              style={{
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
                padding: 14,
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    selectable
                    style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}
                  >
                    Diagnostics
                  </Text>
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                    Inspect progress sync, playback, queue, and transcript export decisions.
                    Filtered export shares only the logs you are currently viewing.
                  </Text>
                </View>
                <Switch
                  value={progressLoggingEnabled}
                  onValueChange={setProgressLoggingEnabled}
                  trackColor={{ false: themeColors.border, true: themeColors.accent }}
                  thumbColor={progressLoggingEnabled ? themeColors.accentForeground : "#f4f4f5"}
                />
              </View>

              <View
                style={{
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.bg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  gap: 6,
                }}
              >
                <DetailLine label="Stored" value={`${entries.length} of 1000 max`} />
                <DetailLine label="Filtered" value={String(filteredEntries.length)} />
                <DetailLine
                  label="Logging"
                  value={progressLoggingEnabled ? "Enabled" : "Disabled"}
                />
              </View>

              <View style={{ gap: 8 }}>
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                >
                  Search
                </Text>
                <View
                  style={{
                    minHeight: 44,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    paddingHorizontal: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <SymbolView name="magnifyingglass" tintColor={themeColors.textMuted} />
                  <TextInput
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholder="Title, library item id, trigger, or outcome"
                    placeholderTextColor={themeColors.textMuted}
                    style={{
                      flex: 1,
                      color: themeColors.text,
                      fontSize: 15,
                      paddingVertical: 10,
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                </View>
              </View>

              <View style={{ gap: 8 }}>
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                >
                  Event Type
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  <FilterChip
                    label="All"
                    value="all"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                  <FilterChip
                    label="Sync Point"
                    value="progress_sync_point"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                  <FilterChip
                    label="Progress Choice"
                    value="progress_resolution"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                  <FilterChip
                    label="Server Fetch"
                    value="server_progress_fetch"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                  <FilterChip
                    label="Queue Sync"
                    value="queue_sync"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                  <FilterChip
                    label="Playback State"
                    value="playback_state_transition"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                  <FilterChip
                    label="Transcript Export"
                    value="clip_transcript_export"
                    selectedValue={eventTypeFilter}
                    onPress={setEventTypeFilter}
                  />
                </ScrollView>
              </View>

              <View style={{ gap: 8 }}>
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                >
                  Session Kind
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <FilterChip
                    label="All"
                    value="all"
                    selectedValue={sessionKindFilter}
                    onPress={setSessionKindFilter}
                  />
                  <FilterChip
                    label="Streamed"
                    value="streamed"
                    selectedValue={sessionKindFilter}
                    onPress={setSessionKindFilter}
                  />
                  <FilterChip
                    label="Downloaded"
                    value="downloaded"
                    selectedValue={sessionKindFilter}
                    onPress={setSessionKindFilter}
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => {
                    setSearchText("");
                    setEventTypeFilter("all");
                    setSessionKindFilter("all");
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                    backgroundColor: themeColors.bg,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.86 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                  >
                    Reset Filters
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    void exportLogs();
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: themeColors.accent,
                    backgroundColor: themeColors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed || isExporting ? 0.86 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      color: themeColors.accentForeground,
                      fontSize: 14,
                      fontWeight: "700",
                    }}
                  >
                    {isExporting ? "Exporting..." : "Export Filtered JSON"}
                  </Text>
                </Pressable>
              </View>

              <Pressable
                onPress={confirmClearLogs}
                style={({ pressed }) => ({
                  minHeight: 42,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.86 : 1,
                })}
              >
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                >
                  Clear Logs
                </Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <LogCard entry={item} />
          </View>
        )}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View
              style={{
                borderWidth: 1,
                borderColor: themeColors.border,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: themeColors.surface,
                padding: 18,
                gap: 8,
              }}
            >
              <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
                No Logs
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                {entries.length
                  ? "No log entries match the current filters."
                  : "No diagnostics have been recorded yet."}
              </Text>
            </View>
          </View>
        }
      />
    </View>
  );
};
