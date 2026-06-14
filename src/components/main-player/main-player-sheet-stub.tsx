import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  title: string;
  description: string;
  icon: SFSymbol;
};

const MainPlayerSheetStub = ({ title, description, icon }: Props) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView className="flex-1 bg-bg">
      <View
        style={{
          flex: 1,
          backgroundColor: themeColors.bg,
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: Math.max(20, insets.bottom + 8),
          justifyContent: "space-between",
        }}
      >
        <View
          style={{
            borderRadius: 24,
            borderCurve: "continuous",
            padding: 20,
            gap: 10,
            alignItems: "center",
            backgroundColor: themeColors.surface,
            borderWidth: 1,
            borderColor: themeColors.border,
            boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: themeColors.bg,
            }}
          >
            <SymbolView name={icon} size={26} tintColor={themeColors.accent} />
          </View>
          <Text selectable style={{ fontSize: 20, fontWeight: "700", color: themeColors.text }}>
            {title}
          </Text>
          <Text
            selectable
            style={{ fontSize: 14, textAlign: "center", color: themeColors.textMuted }}
          >
            {description}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: "continuous",
            paddingVertical: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: themeColors.accent,
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <Text
            selectable
            style={{ color: themeColors.accentForeground, fontWeight: "700", fontSize: 15 }}
          >
            Close
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
};

export default MainPlayerSheetStub;
