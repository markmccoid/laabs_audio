import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, Text, View } from "react-native";

export const SettingsPlaybackScreen = () => {
  const themeColors = useThemeColors();
  const defaultBookProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const { setDefaultBookProgressTimeDisplay } = useSettingsActions();

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
            Book Progress Display
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Sets the default view in Book details. You can still tap the value on a book to switch.
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={() => setDefaultBookProgressTimeDisplay("elapsed")}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor:
                  defaultBookProgressTimeDisplay === "elapsed"
                    ? themeColors.accent
                    : themeColors.border,
                backgroundColor:
                  defaultBookProgressTimeDisplay === "elapsed"
                    ? themeColors.accent
                    : themeColors.bg,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.86 : 1,
              })}
            >
              <Text
                selectable
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color:
                    defaultBookProgressTimeDisplay === "elapsed"
                      ? themeColors.accentForeground
                      : themeColors.text,
                }}
              >
                Time Read
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDefaultBookProgressTimeDisplay("remaining")}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor:
                  defaultBookProgressTimeDisplay === "remaining"
                    ? themeColors.accent
                    : themeColors.border,
                backgroundColor:
                  defaultBookProgressTimeDisplay === "remaining"
                    ? themeColors.accent
                    : themeColors.bg,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.86 : 1,
              })}
            >
              <Text
                selectable
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color:
                    defaultBookProgressTimeDisplay === "remaining"
                      ? themeColors.accentForeground
                      : themeColors.text,
                }}
              >
                Time Left
              </Text>
            </Pressable>
          </View>

          <View
            style={{
              marginTop: 6,
              borderRadius: 12,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              paddingHorizontal: 10,
              paddingVertical: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <SymbolView name="info.circle.fill" size={14} tintColor={themeColors.textMuted} />
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, flex: 1 }}>
              Applies when opening a book. It resets to this default for each book view.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};
