import type { BookmarkViewRecord } from "@/bookmarks/bookmark-contracts";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { MenuView, type MenuAction, type NativeActionEvent } from "@expo/ui/community/menu";
import { SymbolView } from "expo-symbols";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BookmarkMenuActionId = "play" | "detail" | "delete";

export type BookmarkListModel = {
  records: BookmarkViewRecord[];
  isExporting: boolean;
  pendingPlayId: string | null;
  pendingDeleteId: string | null;
};

export type BookmarkListActions = {
  onClose: () => void;
  onExport: () => void;
  onPlay: (record: BookmarkViewRecord) => void;
  onOpenDetail: (record: BookmarkViewRecord) => void;
  onDelete: (record: BookmarkViewRecord) => void;
};

const getBookmarkTimeLabel = (timeSeconds: number) =>
  formatSeconds(timeSeconds, "compact", true, true) ?? "00:00";

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

  const getMenuActions = (disabled: boolean): MenuAction[] => [
    {
      id: "play",
      title: "Play from Bookmark",
      image: "play.fill",
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
    if (actionId === "play") actions.onPlay(record);
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
          borderBottomWidth: 1,
          borderBottomColor: themeColors.border,
          backgroundColor: themeColors.surface,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text selectable style={{ color: themeColors.text, fontSize: 20, fontWeight: "700" }}>
              Bookmarks
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export bookmarks"
              onPress={actions.onExport}
              disabled={model.isExporting || isPlayPending}
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
                opacity: pressed || model.isExporting || isPlayPending ? 0.75 : 1,
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
            accessibilityLabel="Close bookmarks"
            onPress={actions.onClose}
            disabled={model.isExporting || isPlayPending}
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
              opacity: pressed || model.isExporting || isPlayPending ? 0.75 : 1,
            })}
          >
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13, fontWeight: "700" }}>
              Close
            </Text>
          </Pressable>
        </View>
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
          const timeLabel =
            record.kind === "clip" && typeof record.endTimeSeconds === "number"
              ? `${getBookmarkTimeLabel(record.startTimeSeconds)} - ${getBookmarkTimeLabel(
                  record.endTimeSeconds,
                )}`
              : getBookmarkTimeLabel(record.startTimeSeconds);
          const title = record.title.trim();
          const note = record.note?.trim() ?? "";
          const isPending = model.pendingPlayId === record.id;
          const isDeleting = model.pendingDeleteId === record.id;
          const isActionDisabled = isPlayPending || isDeleting;
          const badgeLabel = record.statusLabel ?? (record.kind === "clip" ? "Clip" : null);

          return (
            <MenuView
              title={title}
              actions={getMenuActions(isActionDisabled)}
              onPressAction={(event) => handleMenuAction(event, record)}
              style={{ flex: 1 }}
            >
              <View
                accessibilityRole="button"
                accessibilityLabel={`Open bookmark actions for ${title} at ${timeLabel}`}
                style={{
                  borderRadius: 14,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  opacity: isActionDisabled ? 0.8 : 1,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
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
                      selectable
                      numberOfLines={1}
                      style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
                    >
                      {title}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        selectable
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
                          selectable
                          numberOfLines={1}
                          style={{ flex: 1, color: themeColors.text, fontSize: 12 }}
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
                          <Text selectable style={{ color: themeColors.textMuted, fontSize: 10 }}>
                            {badgeLabel}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                <SymbolView
                  name={isPending || isDeleting ? "hourglass" : "ellipsis"}
                  tintColor={themeColors.textMuted}
                  size={14}
                />
              </View>
            </MenuView>
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
