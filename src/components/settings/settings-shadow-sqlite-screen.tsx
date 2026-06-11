import { useAuthStore } from "@/auth/auth-store";
import { refreshShadowLibraryCatalog, type ShadowCatalogRefreshResult } from "@/data/sqlite/catalog-refresh";
import { refreshShadowUserOverlays, type ShadowOverlayRefreshResult } from "@/data/sqlite/overlay-writes";
import { runShadowSearchTest, type ShadowSearchResult } from "@/data/sqlite/search-reads";
import {
  clearShadowDatabase,
  fetchShadowDetailSnapshot,
  getFirstShadowSearchResultId,
  getShadowDatabaseSummary,
  initializeShadowDatabase,
  type ShadowDatabaseSummary,
} from "@/data/sqlite/shadow-status";
import {
  clearTimingLogs,
  getTimingLogs,
  type TimingLog,
} from "@/data/sqlite/timing-logger";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";

type ActionName =
  | "init"
  | "catalog"
  | "overlays"
  | "search"
  | "detail"
  | "summary"
  | "clear"
  | "timing_logs_clear"
  | "timing_logs_load";

const formatMs = (value: number | null | undefined) =>
  typeof value === "number" ? `${Math.max(0, Math.round(value))}ms` : "-";

const Stat = ({ label, value }: { label: string; value: string | number | null | undefined }) => {
  const themeColors = useThemeColors();
  return (
    <View style={{ gap: 2, minWidth: "45%" }}>
      <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
        {label}
      </Text>
      <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "600" }}>
        {value ?? "-"}
      </Text>
    </View>
  );
};

const ActionButton = ({
  title,
  icon,
  disabled,
  onPress,
}: {
  title: string;
  icon: React.ComponentProps<typeof SymbolView>["name"];
  disabled?: boolean;
  onPress: () => void;
}) => {
  const themeColors = useThemeColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 46,
        borderRadius: 8,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: disabled
          ? themeColors.surface
          : pressed
            ? themeColors.border
            : themeColors.surface,
        opacity: disabled ? 0.55 : 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      })}
    >
      <SymbolView name={icon} tintColor={themeColors.text} />
      <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const themeColors = useThemeColors();
  return (
    <View style={{ gap: 10 }}>
      <Text
        selectable
        style={{
          color: themeColors.textMuted,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          paddingHorizontal: 4,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: themeColors.border,
          borderRadius: 14,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
          padding: 12,
          gap: 12,
        }}
      >
        {children}
      </View>
    </View>
  );
};

const CatalogResult = ({ result }: { result: ShadowCatalogRefreshResult | null }) => {
  if (!result) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <Stat label="Status" value={result.status} />
      <Stat label="Elapsed" value={formatMs(result.elapsedMs)} />
      <Stat label="Network" value={formatMs(result.networkElapsedMs)} />
      <Stat label="Writes" value={formatMs(result.writeElapsedMs)} />
      <Stat label="Finalize" value={formatMs(result.finalizeElapsedMs)} />
      <Stat label="Expected" value={result.totalExpected} />
      <Stat label="Seen" value={result.totalSeen} />
      <Stat label="Inserted" value={result.inserted} />
      <Stat label="Updated" value={result.updated} />
      <Stat label="Unchanged" value={result.unchanged} />
      <Stat label="Missing marked" value={result.missingMarked} />
      <Stat label="Run ID" value={result.runId} />
      {result.error ? <Stat label="Error" value={result.error} /> : null}
    </View>
  );
};

const OverlayResult = ({ result }: { result: ShadowOverlayRefreshResult | null }) => {
  if (!result) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      <Stat label="Status" value={result.status} />
      <Stat label="Elapsed" value={formatMs(result.elapsedMs)} />
      <Stat label="Network" value={formatMs(result.networkElapsedMs)} />
      <Stat label="Writes" value={formatMs(result.writeElapsedMs)} />
      <Stat label="Finalize" value={formatMs(result.finalizeElapsedMs)} />
      <Stat label="Server progress" value={result.serverProgressRows} />
      <Stat label="Pending progress" value={result.pendingProgressRows} />
      <Stat label="Favorites" value={result.favoriteRows} />
      <Stat label="Local bookmarks" value={result.localBookmarkRows} />
      <Stat label="Server bookmarks" value={result.serverBookmarkRows} />
      <Stat label="Pending creates" value={result.pendingBookmarkCreateRows} />
      <Stat label="Pending deletes" value={result.pendingBookmarkDeleteRows} />
      <Stat label="Run ID" value={result.runId} />
      {result.error ? <Stat label="Error" value={result.error} /> : null}
    </View>
  );
};

const SearchResult = ({ result }: { result: ShadowSearchResult | null }) => {
  const themeColors = useThemeColors();
  if (!result) return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Matches" value={result.totalCount} />
        <Stat label="SQL time" value={formatMs(result.sqlElapsedMs)} />
        <Stat label="Map time" value={formatMs(result.mapElapsedMs)} />
        <Stat label="FTS used" value={result.usedFts ? "yes" : "no"} />
        <Stat label="Active rows" value={result.activeCatalogRows} />
        <Stat label="Missing rows" value={result.missingCatalogRows} />
        <Stat label="Progress rows" value={result.progressRows} />
        <Stat label="Favorite rows" value={result.favoriteRows} />
        <Stat label="Bookmark rows" value={result.localBookmarkRows} />
      </View>
      <View style={{ gap: 8 }}>
        {result.rows.slice(0, 10).map((book) => (
          <View
            key={book.id}
            style={{ borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 8 }}
          >
            <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}>
              {book.title}
            </Text>
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
              {book.author || "Unknown author"}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const SummaryPanel = ({ summary }: { summary: ShadowDatabaseSummary | null }) => {
  if (!summary) return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Schema" value={summary.schemaVersion} />
        <Stat label="Active catalog" value={summary.activeCatalogRows} />
        <Stat label="Missing catalog" value={summary.missingCatalogRows} />
        <Stat label="Favorites" value={summary.favoriteRows} />
        <Stat label="Server progress" value={summary.serverProgressRows} />
        <Stat label="Pending progress" value={summary.pendingProgressRows} />
        <Stat label="Local bookmarks" value={summary.localBookmarkRows} />
        <Stat label="Detail snapshots" value={summary.detailSnapshotRows} />
      </View>
      {summary.lastRuns.map((run) => (
        <View key={run.id} style={{ gap: 3 }}>
          <Stat label={`Run ${run.status}`} value={run.id} />
          <Stat
            label="Counts"
            value={`seen ${run.totalSeen}/${run.totalExpected}, +${run.inserted}, ~${run.updated}, =${run.unchanged}, missing ${run.missingMarked}`}
          />
          {run.error ? <Stat label="Error" value={run.error} /> : null}
        </View>
      ))}
      {summary.lastOverlayRuns.map((run) => (
        <View key={run.id} style={{ gap: 3 }}>
          <Stat label={`Overlay ${run.status}`} value={run.id} />
          <Stat
            label="Timing"
            value={`total ${formatMs(run.elapsedMs)}, network ${formatMs(run.networkElapsedMs)}, writes ${formatMs(run.writeElapsedMs)}, finalize ${formatMs(run.finalizeElapsedMs)}`}
          />
          <Stat
            label="Rows"
            value={`progress ${run.serverProgressRows}, pending ${run.pendingProgressRows}, favorites ${run.favoriteRows}, local bookmarks ${run.localBookmarkRows}, server bookmarks ${run.serverBookmarkRows}`}
          />
          {run.error ? <Stat label="Error" value={run.error} /> : null}
        </View>
      ))}
    </View>
  );
};

const TimingLogItem = ({
  log,
  isExpanded,
  onToggle,
}: {
  log: TimingLog;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const themeColors = useThemeColors();
  const dateStr = useMemo(() => {
    try {
      return new Date(log.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "-";
    }
  }, [log.createdAt]);

  const parsedMetadata = useMemo(() => {
    if (!log.metadata) return null;
    try {
      return JSON.parse(log.metadata);
    } catch {
      return log.metadata;
    }
  }, [log.metadata]);

  // Accent color based on category
  const categoryColor = useMemo(() => {
    switch (log.category) {
      case "startup":
        return "#10b981"; // Emerald green
      case "library_switch":
        return "#3b82f6"; // Blue
      case "login":
        return "#a855f7"; // Purple
      default:
        return themeColors.textMuted;
    }
  }, [log.category, themeColors.textMuted]);

  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: themeColors.border,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}>
              {log.eventName}
            </Text>
            <View
              style={{
                backgroundColor: `${categoryColor}15`,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                borderWidth: 0.5,
                borderColor: `${categoryColor}30`,
              }}
            >
              <Text
                selectable
                style={{
                  color: categoryColor,
                  fontSize: 10,
                  fontWeight: "700",
                  textTransform: "uppercase",
                }}
              >
                {log.category}
              </Text>
            </View>
          </View>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 11 }}>
            {dateStr}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
            {formatMs(log.durationMs)}
          </Text>
          {parsedMetadata ? (
            <Pressable
              onPress={onToggle}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 2,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                {isExpanded ? "Hide Details" : "Show Details"}
              </Text>
              <SymbolView
                name={isExpanded ? "chevron.up" : "chevron.down"}
                size={10}
                tintColor={themeColors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isExpanded && parsedMetadata ? (
        <View
          style={{
            backgroundColor: themeColors.bg,
            borderRadius: 6,
            padding: 8,
            marginTop: 4,
            borderWidth: 0.5,
            borderColor: themeColors.border,
          }}
        >
          <Text
            selectable
            style={{
              fontFamily: "Courier",
              fontSize: 11,
              color: themeColors.text,
            }}
          >
            {JSON.stringify(parsedMetadata, null, 2)}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

export const SettingsShadowSqliteScreen = () => {
  const themeColors = useThemeColors();
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogResult, setCatalogResult] = useState<ShadowCatalogRefreshResult | null>(null);
  const [overlayResult, setOverlayResult] = useState<ShadowOverlayRefreshResult | null>(null);
  const [searchResult, setSearchResult] = useState<ShadowSearchResult | null>(null);
  const [summary, setSummary] = useState<ShadowDatabaseSummary | null>(null);
  const [timingLogs, setTimingLogs] = useState<TimingLog[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});

  const canUseShadowDb = status === "authenticated" && Boolean(activeLibraryId);
  const isBusy = busyAction !== null;

  const loadLogs = useCallback(async () => {
    try {
      const logs = await getTimingLogs(50);
      setTimingLogs(logs);
    } catch (error) {
      console.warn("Failed to load timing logs", error);
    }
  }, []);

  const runAction = useCallback(
    async (action: ActionName, task: () => Promise<string | null | undefined>) => {
      setBusyAction(action);
      setMessage(null);
      try {
        const nextMessage = await task();
        setMessage(nextMessage ?? "Done");
        setSummary(await getShadowDatabaseSummary());
        await loadLogs();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setMessage(errorMessage);
      } finally {
        setBusyAction(null);
      }
    },
    [loadLogs],
  );

  useEffect(() => {
    if (!canUseShadowDb) return;
    void getShadowDatabaseSummary()
      .then(setSummary)
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLogs();
  }, [canUseShadowDb, loadLogs]);

  const handleExportLogs = useCallback(async () => {
    try {
      const allLogs = await getTimingLogs(500);
      const shareMessage = JSON.stringify(allLogs, null, 2);
      await Share.share({
        title: "Laabs Audio Timing Logs",
        message: shareMessage,
      });
    } catch (error) {
      Alert.alert("Export Failed", error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleClearLogs = useCallback(() => {
    Alert.alert("Clear Timing Logs?", "This will delete all persistent startup and performance timing logs.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () =>
          runAction("timing_logs_clear", async () => {
            await clearTimingLogs();
            setTimingLogs([]);
            setExpandedLogIds({});
            return "Timing logs cleared";
          }),
      },
    ]);
  }, [runAction]);

  const activeLabel = useMemo(
    () => activeLibraryName || activeLibraryId || "No Active Library",
    [activeLibraryId, activeLibraryName],
  );

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 34,
          gap: 18,
        }}
      >
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          Shadow SQLite diagnostics for loading, storing, and querying the Active Library before
          production screens read from SQLite.
        </Text>

        <Section title="Session">
          <Stat label="Status" value={status} />
          <Stat label="Active Library" value={activeLabel} />
        </Section>

        <Section title="Actions">
          <ActionButton
            title={busyAction === "init" ? "Initializing..." : "Initialize DB"}
            icon="cylinder.split.1x2"
            disabled={!canUseShadowDb || isBusy}
            onPress={() =>
              runAction("init", async () => {
                await initializeShadowDatabase();
                return "Shadow database initialized";
              })
            }
          />
          <ActionButton
            title={busyAction === "catalog" ? "Refreshing Catalog..." : "Refresh Active Library"}
            icon="arrow.clockwise"
            disabled={!canUseShadowDb || isBusy}
            onPress={() =>
              runAction("catalog", async () => {
                const result = await refreshShadowLibraryCatalog();
                setCatalogResult(result);
                return `Catalog refresh ${result.status}`;
              })
            }
          />
          <ActionButton
            title={busyAction === "overlays" ? "Refreshing Overlays..." : "Refresh User Overlays"}
            icon="person.text.rectangle"
            disabled={!canUseShadowDb || isBusy}
            onPress={() =>
              runAction("overlays", async () => {
                const result = await refreshShadowUserOverlays();
                setOverlayResult(result);
                return "User overlays refreshed";
              })
            }
          />
          <ActionButton
            title={busyAction === "detail" ? "Fetching Detail..." : "Fetch First Detail Snapshot"}
            icon="doc.text.magnifyingglass"
            disabled={!canUseShadowDb || isBusy}
            onPress={() =>
              runAction("detail", async () => {
                const id = await getFirstShadowSearchResultId();
                if (!id) return "No catalog row available for detail fetch";
                const result = await fetchShadowDetailSnapshot(id);
                return `Fetched detail snapshot for ${result.libraryItemId}`;
              })
            }
          />
          <ActionButton
            title={busyAction === "summary" ? "Loading Summary..." : "Open Recent Runs"}
            icon="list.bullet.rectangle"
            disabled={!canUseShadowDb || isBusy}
            onPress={() =>
              runAction("summary", async () => {
                setSummary(await getShadowDatabaseSummary());
                return "Summary loaded";
              })
            }
          />
          <ActionButton
            title={busyAction === "clear" ? "Clearing..." : "Clear Shadow DB"}
            icon="trash"
            disabled={isBusy}
            onPress={() => {
              Alert.alert("Clear Shadow DB?", "This resets only the shadow SQLite schema and data.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Clear",
                  style: "destructive",
                  onPress: () =>
                    runAction("clear", async () => {
                      await clearShadowDatabase();
                      setCatalogResult(null);
                      setOverlayResult(null);
                      setSearchResult(null);
                      setSummary(null);
                      return "Shadow database cleared";
                    }),
                },
              ]);
            }}
          />
        </Section>

        <Section title="Search Test">
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Title, author, narrator, or series"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              minHeight: 44,
              borderRadius: 8,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              paddingHorizontal: 12,
              color: themeColors.text,
              backgroundColor: themeColors.bg,
            }}
          />
          <ActionButton
            title={busyAction === "search" ? "Running Search..." : "Run Search Test"}
            icon="magnifyingglass"
            disabled={!canUseShadowDb || isBusy}
            onPress={() =>
              runAction("search", async () => {
                const result = await runShadowSearchTest({ query: searchQuery });
                setSearchResult(result);
                return `Search returned ${result.totalCount} matches`;
              })
            }
          />
          <SearchResult result={searchResult} />
        </Section>

        {message ? (
          <Section title="Latest Message">
            <Text selectable style={{ color: themeColors.text, fontSize: 14 }}>
              {message}
            </Text>
          </Section>
        ) : null}

        <Section title="Catalog Refresh">
          <CatalogResult result={catalogResult} />
        </Section>

        <Section title="Overlay Refresh">
          <OverlayResult result={overlayResult} />
        </Section>

        <Section title="Database Summary">
          <SummaryPanel summary={summary} />
        </Section>

        <Section title="Diagnostics Timing Logs">
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 100 }}>
              <ActionButton
                title={busyAction === "timing_logs_load" ? "Loading..." : "Refresh Logs"}
                icon="clock.arrow.2.circlepath"
                disabled={isBusy}
                onPress={() =>
                  runAction("timing_logs_load", async () => {
                    await loadLogs();
                    return "Timing logs refreshed";
                  })
                }
              />
            </View>
            <View style={{ flex: 1, minWidth: 100 }}>
              <ActionButton
                title="Export Logs"
                icon="square.and.arrow.up"
                disabled={timingLogs.length === 0}
                onPress={handleExportLogs}
              />
            </View>
            <View style={{ flex: 1, minWidth: 100 }}>
              <ActionButton
                title="Clear Logs"
                icon="trash"
                disabled={timingLogs.length === 0 || isBusy}
                onPress={handleClearLogs}
              />
            </View>
          </View>

          {timingLogs.length === 0 ? (
            <Text
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 13,
                textAlign: "center",
                paddingVertical: 12,
              }}
            >
              No timing logs recorded yet.
            </Text>
          ) : (
            <View style={{ gap: 2 }}>
              {timingLogs.map((log) => (
                <TimingLogItem
                  key={log.id}
                  log={log}
                  isExpanded={Boolean(expandedLogIds[log.id])}
                  onToggle={() =>
                    setExpandedLogIds((prev) => ({
                      ...prev,
                      [log.id]: !prev[log.id],
                    }))
                  }
                />
              ))}
            </View>
          )}
        </Section>
      </ScrollView>
    </View>
  );
};
