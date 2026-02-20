import type { HomeShelf } from "@/hooks/use-home-shelves";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import Sortable from "react-native-sortables";

type BookshelfListItemProps = {
  shelf: HomeShelf;
  onPress: (shelf: HomeShelf) => void;
  itemWidth?: number;
};

export const BookshelfListItem = ({ shelf, onPress, itemWidth }: BookshelfListItemProps) => {
  const themeColors = useThemeColors();
  const isHidden = !shelf.isVisible;
  const statusColor = isHidden ? themeColors.textMuted : themeColors.accent;
  const statusIcon = isHidden ? "eye.slash.fill" : "checkmark.circle.fill";
  const statusLabel = isHidden ? "Hidden" : "Shown";
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
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                selectable
                numberOfLines={1}
                style={{ color: primaryTextColor, fontSize: 16, fontWeight: "600", flexShrink: 1 }}
              >
                {shelf.title}
              </Text>
            </View>
            <Text
              selectable
              numberOfLines={1}
              style={{ color: themeColors.textMuted, fontSize: 12 }}
            >
              {shelf.kind === "derived" ? "Built-in shelf" : "Custom shelf"}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end", gap: 1 }}>
            <Text selectable style={{ color: primaryTextColor, fontSize: 13, fontWeight: "600" }}>
              {shelf.homeItemCount} items
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <SymbolView name={statusIcon} tintColor={statusColor} />
              <Text selectable style={{ color: statusColor, fontSize: 12, fontWeight: "700" }}>
                {statusLabel}
              </Text>
            </View>
          </View>

          <SymbolView name="chevron.right" tintColor={themeColors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
};
