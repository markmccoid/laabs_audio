import { useThemeColors } from "@/theme/use-app-theme";
import * as Linking from "expo-linking";
import { SymbolView } from "expo-symbols";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

const ASSISTANT_PHRASES = [
  "Play [book] in LAABS Audio",
  "Listen to [book] in LAABS Audio",
  "Play LAABS Audio",
  "Resume LAABS Audio",
  "Continue listening in LAABS Audio",
  "Resume my book in LAABS Audio",
  "Pause LAABS Audio",
  "Search my library in LAABS Audio",
  "Find an audiobook in LAABS Audio",
  "Find books by an author in LAABS Audio",
  "Bookmark this in LAABS Audio",
  "Add a bookmark in LAABS Audio",
  "Set a sleep timer in LAABS Audio",
  "Sleep timer LAABS Audio",
] as const;

export const SettingsSiriShortcutsScreen = () => {
  const themeColors = useThemeColors();

  const openShortcuts = async () => {
    try {
      await Linking.openURL("shortcuts://");
    } catch {
      Alert.alert("Could not open Shortcuts", "Open the Shortcuts app to find LAABS Audio actions.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 32, gap: 20 }}
      >
        <View style={{ gap: 8, paddingHorizontal: 4 }}>
          <Text style={{ color: themeColors.text, fontSize: 22, fontWeight: "700" }}>
            Siri & Shortcuts
          </Text>
          <Text style={{ color: themeColors.textMuted, fontSize: 15, lineHeight: 21 }}>
            Ask Siri with one of these phrases, or combine LAABS Audio actions into your own
            shortcuts.
          </Text>
        </View>

        <View
          style={{
            borderWidth: 1,
            borderColor: themeColors.border,
            borderRadius: 14,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: themeColors.surface,
          }}
        >
          {ASSISTANT_PHRASES.map((phrase, index) => (
            <View
              key={phrase}
              style={{
                minHeight: 52,
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderBottomWidth: index === ASSISTANT_PHRASES.length - 1 ? 0 : 1,
                borderBottomColor: themeColors.border,
              }}
            >
              <SymbolView name="quote.bubble" size={18} tintColor={themeColors.accent} />
              <Text
                selectable
                style={{ flex: 1, color: themeColors.text, fontSize: 15, lineHeight: 20 }}
              >
                “{phrase}”
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Shortcuts"
          onPress={() => void openShortcuts()}
          style={({ pressed }) => ({
            minHeight: 52,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: themeColors.accent,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <SymbolView name="square.grid.2x2" size={18} tintColor={themeColors.accentForeground} />
          <Text style={{ color: themeColors.accentForeground, fontSize: 16, fontWeight: "700" }}>
            Open Shortcuts
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
};
