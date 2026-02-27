import type { HomeShelf } from "@/hooks/use-home-shelves";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import Sortable from "react-native-sortables";

type BookshelfListItemProps = {
  shelf: HomeShelf;
  onPress: (shelf: HomeShelf) => void;
  onToggleVisibility: (shelf: HomeShelf, nextVisibility: boolean) => void;
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
  const syncStatus = (() => {
    if (shelf.kind === "playlist" && shelf.syncState === "missing") {
      return {
        label: "Missing",
        icon: "exclamationmark.triangle.fill",
        color: "#b36f00",
      };
    }
    if (shelf.kind === "playlist" && shelf.syncState === "unsynced") {
      return {
        label: "Unsynced",
        icon: "exclamationmark.circle.fill",
        color: "#d24b20",
      };
    }
    if (shelf.kind === "playlist" && shelf.syncState === "pending") {
      return {
        label: "Pending",
        icon: "clock.fill",
        color: themeColors.absGold,
      };
    }
    return null;
  })();

  const typeInfo = (() => {
    if (shelf.kind === "derived") {
      return {
        label: "Derived",
        borderColor: themeColors.border,
        bg: themeColors.bg,
        textColor: themeColors.textMuted,
      };
    }
    if (shelf.kind === "custom") {
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
                {typeInfo.label}
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
