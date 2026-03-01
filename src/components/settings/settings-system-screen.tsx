import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Switch, ScrollView, Text, View } from "react-native";

export const SettingsSystemScreen = () => {
  const themeColors = useThemeColors();
  const useTokenWithCoverImages = useSettingsStore((state) => state.useTokenWithCoverImages);
  const { setUseTokenWithCoverImages } = useSettingsActions();

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 24,
          gap: 14,
        }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 16,
            borderCurve: "continuous",
            padding: 14,
            gap: 10,
            backgroundColor: themeColors.surface,
          }}
        >
          <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
            Cover Images
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Controls how the app requests and falls back for book cover images.
          </Text>
          <View
            style={{
              marginTop: 6,
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              paddingHorizontal: 12,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                Use token with cover images
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                When off, the app tries public cover URLs first and only retries with a token if
                needed.
              </Text>
            </View>
            <Switch
              value={useTokenWithCoverImages}
              onValueChange={setUseTokenWithCoverImages}
              trackColor={{ false: themeColors.border, true: themeColors.accent }}
              thumbColor={useTokenWithCoverImages ? themeColors.accentForeground : "#f4f4f5"}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
};
