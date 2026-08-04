import type { BookmarkViewRecord } from "@/bookmarks/bookmark-contracts";
import type { TemporaryPlaybackStatus } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import { SymbolView } from "expo-symbols";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BookmarkMenuActionId = "move" | "detail" | "delete";

export type BookmarkListTemporaryPlayback = {
  activeBookmarkId: string;
  activeBookmarkTitle: string;
  activeKind: "point" | "clip";
  startTimeSeconds: number;
  endTimeSeconds: number | null;
  positionSeconds: number;
  returnPositionSeconds: number;
  status: TemporaryPlaybackStatus;
};

export type BookmarkListModel = {
  records: BookmarkViewRecord[];
  isExporting: boolean;
  pendingPlayId: string | null;
  pendingDeleteId: string | null;
  isMediaLoaded: boolean;
  temporaryPlayback: BookmarkListTemporaryPlayback | null;
};

export type BookmarkListActions = {
  onClose: () => void;
  onExport: () => void;
  onTogglePlayback: (record: BookmarkViewRecord) => void;
  onToggleHeaderPlayback: () => void;
  onReturn: () => void;
  onMoveProgress: (record: BookmarkViewRecord) => void;
  onOpenDetail: (record: BookmarkViewRecord) => void;
  onDelete: (record: BookmarkViewRecord) => void;
};

const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";

const getRecordTimeLabel = (record: BookmarkViewRecord) =>
  record.kind === "clip" && typeof record.endTimeSeconds === "number"
    ? `${getBookmarkTimeLabel(record.startTimeSeconds)} – ${getBookmarkTimeLabel(
        record.endTimeSeconds,
      )}`
    : getBookmarkTimeLabel(record.startTimeSeconds);

export const BookmarkListView = ({
  model,
  actions,
}: {
  model: BookmarkListModel;
  actions: BookmarkListActions;
}) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const isPlayPending = model.pendingPlayId !== null;
  const isTemporaryPlaying = model.temporaryPlayback?.status === "playing";
  const headerDisabled = model.isExporting || isPlayPending;

  const getMenuActions = (record: BookmarkViewRecord, disabled: boolean): MenuAction[] => [
    {
      id: "move",
      title: model.isMediaLoaded
        ? "Move Progress Here"
        : record.kind === "clip"
          ? "Load at Clip Start"
          : "Load at Bookmark",
      image: "arrow.right.to.line",
      attributes: { disabled },
    },
    {
      id: "detail",
      title: "Bookmark Details",
      image: "square.and.pencil",
      attributes: { disabled },
    },
    {
      id: "delete",
      title: "Delete Bookmark",
      image: "trash",
      attributes: { destructive: true, disabled },
    },
  ];

  const handleMenuAction = (event: NativeActionEvent, record: BookmarkViewRecord) => {
    const actionId = event.nativeEvent.event as BookmarkMenuActionId;
    if (actionId === "move") actions.onMoveProgress(record);
    if (actionId === "detail") actions.onOpenDetail(record);
    if (actionId === "delete") {
      const timeLabel = getBookmarkTimeLabel(record.startTimeSeconds);
      Alert.alert("Delete bookmark?", `Delete "${record.title.trim()}" at ${timeLabel}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => actions.onDelete(record),
        },
      ]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }} collapsable={false}>
      <View
        collapsable={false}
        style={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 14,
          gap: 12,
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text
              selectable
              style={{
                color: themeColors.text,
                fontSize: 20,
                fontWeight: "700",
              }}
            >
              Bookmarks
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export bookmarks"
              onPress={actions.onExport}
              disabled={headerDisabled}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed || headerDisabled ? 0.65 : 1,
              })}
            >
              <SymbolView
                name={model.isExporting ? "hourglass" : "square.and.arrow.up"}
                tintColor={themeColors.textMuted}
                size={15}
              />
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close bookmarks and return to saved position"
            onPress={actions.onClose}
            disabled={headerDisabled}
            style={({ pressed }) => ({
              minWidth: 72,
              height: 34,
              borderRadius: 17,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 12,
              opacity: pressed || headerDisabled ? 0.65 : 1,
            })}
          >
            <Text
              selectable
              style={{
                color: themeColors.textMuted,
                fontSize: 13,
                fontWeight: "700",
              }}
            >
              Close
            </Text>
          </Pressable>
        </View>

        {model.temporaryPlayback ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              borderRadius: 16,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.accent,
              backgroundColor: themeColors.bg,
              padding: 12,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isTemporaryPlaying ? "Pause bookmark playback" : "Resume bookmark playback"
                }
                onPress={actions.onToggleHeaderPlayback}
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  borderCurve: "continuous",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: themeColors.accent,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <SymbolView
                  name={isTemporaryPlaying ? "pause.fill" : "play.fill"}
                  tintColor={themeColors.accentForeground}
                  size={17}
                />
              </Pressable>
              <View style={{ flex: 1, gap: 3 }}>
                <Text
                  style={{
                    color: themeColors.textMuted,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  {model.temporaryPlayback.activeKind === "clip"
                    ? "Playing clip"
                    : "Playing from bookmark"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: themeColors.text,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                >
                  {model.temporaryPlayback.activeBookmarkTitle}
                </Text>
                <Text
                  style={{
                    color: themeColors.textMuted,
                    fontSize: 12,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {model.temporaryPlayback.activeKind === "clip" &&
                  model.temporaryPlayback.endTimeSeconds !== null
                    ? `${getBookmarkTimeLabel(model.temporaryPlayback.startTimeSeconds)} – ${getBookmarkTimeLabel(
                        model.temporaryPlayback.endTimeSeconds,
                      )}`
                    : `From ${getBookmarkTimeLabel(model.temporaryPlayback.startTimeSeconds)}`}
                  {` · Now ${getBookmarkTimeLabel(model.temporaryPlayback.positionSeconds)}`}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Return to ${getBookmarkTimeLabel(
                model.temporaryPlayback.returnPositionSeconds,
              )}`}
              onPress={actions.onReturn}
              style={({ pressed }) => ({
                minHeight: 42,
                borderRadius: 12,
                borderCurve: "continuous",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 14,
                backgroundColor: themeColors.accent,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <Text
                style={{
                  color: themeColors.accentForeground,
                  fontSize: 14,
                  fontWeight: "800",
                }}
              >
                Return to {getBookmarkTimeLabel(model.temporaryPlayback.returnPositionSeconds)}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <FlatList
        data={model.records}
        keyExtractor={(record) => record.id}
        style={{ flex: 1 }}
        bounces={false}
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Math.max(24, insets.bottom + 12),
          gap: 10,
        }}
        renderItem={({ item: record }) => {
          const timeLabel = getRecordTimeLabel(record);
          const title = record.title.trim();
          const note = record.note?.trim() ?? "";
          const isPending = model.pendingPlayId === record.id;
          const isDeleting = model.pendingDeleteId === record.id;
          const isActive = model.temporaryPlayback?.activeBookmarkId === record.id;
          const isActivePlaying = isActive && model.temporaryPlayback?.status === "playing";
          const isActionDisabled = isPlayPending || isDeleting;
          const badgeLabel = record.statusLabel ?? (record.kind === "clip" ? "Clip" : null);

          return (
            <View
              style={{
                borderRadius: 14,
                borderCurve: "continuous",
                borderWidth: isActive ? 2 : 1,
                borderColor: isActive ? themeColors.accent : themeColors.border,
                backgroundColor: themeColors.surface,
                flexDirection: "row",
                alignItems: "stretch",
                overflow: "hidden",
                opacity: isActionDisabled ? 0.8 : 1,
              }}
            >
              <MenuView
                title={title}
                actions={getMenuActions(record, isActionDisabled)}
                onPressAction={(event) => handleMenuAction(event, record)}
                style={{ flex: 1 }}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={`Open actions for ${title} at ${timeLabel}`}
                  style={{
                    flex: 1,
                    minHeight: 58,
                    paddingLeft: 12,
                    paddingVertical: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      borderCurve: "continuous",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: themeColors.bg,
                      borderWidth: 1,
                      borderColor: themeColors.border,
                    }}
                  >
                    <SymbolView name="bookmark.fill" tintColor={themeColors.accent} size={13} />
                  </View>
                  <View style={{ flex: 1, gap: 2, paddingRight: 10 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: themeColors.text,
                        fontSize: 14,
                        fontWeight: "600",
                      }}
                    >
                      {title}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Text
                        style={{
                          color: themeColors.textMuted,
                          fontSize: 12,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {timeLabel}
                      </Text>
                      {note ? (
                        <Text
                          numberOfLines={1}
                          style={{
                            flex: 1,
                            color: themeColors.text,
                            fontSize: 12,
                          }}
                        >
                          {note}
                        </Text>
                      ) : null}
                      {badgeLabel ? (
                        <View
                          style={{
                            borderRadius: 999,
                            borderCurve: "continuous",
                            borderWidth: 1,
                            borderColor: themeColors.border,
                            backgroundColor: themeColors.bg,
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                          }}
                        >
                          <Text
                            style={{
                              color: themeColors.textMuted,
                              fontSize: 10,
                            }}
                          >
                            {badgeLabel}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              </MenuView>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isActivePlaying
                    ? `Pause ${title}`
                    : model.isMediaLoaded
                      ? `Play ${title} without moving progress`
                      : `Load this item to play ${title} without moving progress`
                }
                accessibilityHint={
                  model.isMediaLoaded
                    ? "Keeps your current listening position protected"
                    : "Use the bookmark menu to load this item"
                }
                onPress={() => actions.onTogglePlayback(record)}
                disabled={isActionDisabled}
                style={({ pressed }) => ({
                  width: 58,
                  minHeight: 58,
                  borderLeftWidth: 1,
                  borderLeftColor: isActive ? themeColors.accent : themeColors.border,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isActive ? themeColors.accent : themeColors.bg,
                  opacity: pressed || !model.isMediaLoaded ? 0.55 : 1,
                })}
              >
                <SymbolView
                  name={isPending ? "hourglass" : isActivePlaying ? "pause.fill" : "play.fill"}
                  tintColor={isActive ? themeColors.accentForeground : themeColors.accent}
                  size={18}
                />
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View
            style={{
              borderRadius: 14,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.surface,
              paddingHorizontal: 14,
              paddingVertical: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 14 }}>
              No Bookmarks
            </Text>
          </View>
        }
      />
    </View>
  );
};
