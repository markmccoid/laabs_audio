import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export const SettingsPlaybackScreen = () => {
  const themeColors = useThemeColors();
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const defaultBookProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const [backwardSkipDraft, setBackwardSkipDraft] = useState<string | null>(null);
  const [forwardSkipDraft, setForwardSkipDraft] = useState<string | null>(null);
  const { setDefaultBookProgressTimeDisplay, setSeekBackwardSeconds, setSeekForwardSeconds } =
    useSettingsActions();
  const backwardSkipValue = backwardSkipDraft ?? String(seekBackwardSeconds);
  const forwardSkipValue = forwardSkipDraft ?? String(seekForwardSeconds);

  const commitBackwardSkipDraft = () => {
    const parsedSeconds = Number.parseInt(backwardSkipValue.trim(), 10);
    if (Number.isNaN(parsedSeconds)) {
      setBackwardSkipDraft(null);
      return;
    }
    setSeekBackwardSeconds(parsedSeconds);
    setBackwardSkipDraft(null);
  };

  const commitForwardSkipDraft = () => {
    const parsedSeconds = Number.parseInt(forwardSkipValue.trim(), 10);
    if (Number.isNaN(parsedSeconds)) {
      setForwardSkipDraft(null);
      return;
    }
    setSeekForwardSeconds(parsedSeconds);
    setForwardSkipDraft(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
            Skip Time Seconds
          </Text>

          <View>
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
              <Text
                selectable
                style={{ minWidth: 74, color: themeColors.text, fontSize: 14, fontWeight: "600" }}
              >
                Backward
              </Text>
              <TextInput
                value={backwardSkipValue}
                onChangeText={(nextValue) => setBackwardSkipDraft(nextValue.replace(/[^0-9]/g, ""))}
                onBlur={commitBackwardSkipDraft}
                onEndEditing={commitBackwardSkipDraft}
                keyboardType="number-pad"
                inputMode="numeric"
                returnKeyType="done"
                maxLength={3}
                style={{
                  flex: 1,
                  minHeight: 36,
                  borderRadius: 10,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  color: themeColors.text,
                  fontSize: 16,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              />

              <Text
                selectable
                style={{ minWidth: 74, color: themeColors.text, fontSize: 14, fontWeight: "600" }}
              >
                Forward
              </Text>
              <TextInput
                value={forwardSkipValue}
                onChangeText={(nextValue) => setForwardSkipDraft(nextValue.replace(/[^0-9]/g, ""))}
                onBlur={commitForwardSkipDraft}
                onEndEditing={commitForwardSkipDraft}
                keyboardType="number-pad"
                inputMode="numeric"
                returnKeyType="done"
                maxLength={3}
                style={{
                  flex: 1,
                  minHeight: 36,
                  borderRadius: 10,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  backgroundColor: themeColors.surface,
                  color: themeColors.text,
                  fontSize: 16,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              />
            </View>
          </View>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, marginTop: 2 }}>
            Lock screen skip controls use the matching forward and backward values.
          </Text>
        </View>

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
