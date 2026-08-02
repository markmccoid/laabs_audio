import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import Sortable from "react-native-sortables";
import type { BookshelfSettingsItem } from "./bookshelf-settings-types";

type BookshelfListItemProps = {
  shelf: BookshelfSettingsItem;
  onPress: (shelf: BookshelfSettingsItem) => void;
  onToggleVisibility: (
    shelf: BookshelfSettingsItem,
    nextVisibility: boolean,
  ) => void;
  itemWidth?: number;
};

export const BookshelfListItem = ({
  shelf,
  onPress,
  onToggleVisibility,
  itemWidth,
}: BookshelfListItemProps) => {
  const themeColors = useThemeColors();
  const isHidden = !shelf.isVisible;
  const syncStatus = shelf.syncStatus
    ? {
        label: shelf.syncStatus.label,
        icon:
          shelf.syncStatus.tone === "warning"
            ? "exclamationmark.triangle.fill"
            : shelf.syncStatus.tone === "error"
              ? "exclamationmark.circle.fill"
              : "clock.fill",
        color:
          shelf.syncStatus.tone === "warning"
            ? "#b36f00"
            : shelf.syncStatus.tone === "error"
              ? "#d24b20"
              : themeColors.absGold,
      }
    : null;

  const typeInfo = (() => {
    if (shelf.kindTone === "derived") {
      return {
        label: "Derived",
        borderColor: themeColors.border,
        bg: themeColors.bg,
        textColor: themeColors.textMuted,
      };
    }
    if (shelf.kindTone === "custom") {
      return {
        label: "Custom",
        borderColor: themeColors.accent,
        bg: themeColors.accent,
        textColor: themeColors.accentForeground,
      };
    }
    return {
      label: "Playlist",
      borderColor: themeColors.absGold,
      bg: themeColors.absGold,
      textColor: "#201607",
    };
  })();

  const primaryTextColor = isHidden ? themeColors.textMuted : themeColors.text;

  return (
    <View
      className="self-stretch"
      style={{
        width: itemWidth ?? "100%",
        alignSelf: "stretch",
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          minHeight: 66,
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Sortable.Handle style={{ paddingHorizontal: 2, paddingVertical: 6 }}>
          <SymbolView name="line.3.horizontal" tintColor={themeColors.textMuted} />
        </Sortable.Handle>

        <Pressable
          onPress={() => onPress(shelf)}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              selectable
              numberOfLines={1}
              style={{ color: primaryTextColor, fontSize: 15, fontWeight: "600", flexShrink: 1 }}
            >
              {shelf.title}
            </Text>
            <View
              style={{
                alignSelf: "flex-start",
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: typeInfo.borderColor,
                backgroundColor: typeInfo.bg,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                selectable
                style={{ color: typeInfo.textColor, fontSize: 10, fontWeight: "700" }}
              >
                {shelf.kindLabel}
              </Text>
            </View>
          </View>

          <View style={{ alignItems: "flex-end", gap: 1 }}>
            <Text selectable style={{ color: primaryTextColor, fontSize: 13, fontWeight: "600" }}>
              {shelf.homeItemCount} items
            </Text>
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                onToggleVisibility(shelf, !shelf.isVisible);
              }}
              style={{
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: isHidden ? themeColors.border : themeColors.accent,
                backgroundColor: isHidden ? themeColors.bg : themeColors.accent,
                paddingHorizontal: 10,
                paddingVertical: 3,
              }}
            >
              <Text
                selectable
                style={{
                  color: isHidden ? themeColors.textMuted : themeColors.accentForeground,
                  fontSize: 11,
                  fontWeight: "700",
                }}
              >
                {isHidden ? "Hidden" : "Shown"}
              </Text>
            </Pressable>
            {syncStatus ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <SymbolView name={syncStatus.icon as never} tintColor={syncStatus.color} />
                <Text
                  selectable
                  style={{ color: syncStatus.color, fontSize: 12, fontWeight: "700" }}
                >
                  {syncStatus.label}
                </Text>
              </View>
            ) : null}
          </View>

          <SymbolView name="chevron.right" tintColor={themeColors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
};
