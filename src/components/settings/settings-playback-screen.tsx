import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export const SettingsPlaybackScreen = () => {
  const themeColors = useThemeColors();
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const defaultBookProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const [backwardSkipDraft, setBackwardSkipDraft] = useState(() => String(seekBackwardSeconds));
  const [forwardSkipDraft, setForwardSkipDraft] = useState(() => String(seekForwardSeconds));
  const { setDefaultBookProgressTimeDisplay, setSeekBackwardSeconds, setSeekForwardSeconds } =
    useSettingsActions();

  useEffect(() => {
    setBackwardSkipDraft(String(seekBackwardSeconds));
  }, [seekBackwardSeconds]);

  useEffect(() => {
    setForwardSkipDraft(String(seekForwardSeconds));
  }, [seekForwardSeconds]);

  const commitBackwardSkipDraft = () => {
    const parsedSeconds = Number.parseInt(backwardSkipDraft.trim(), 10);
    if (Number.isNaN(parsedSeconds)) {
      setBackwardSkipDraft(String(seekBackwardSeconds));
      return;
    }
    setSeekBackwardSeconds(parsedSeconds);
  };

  const commitForwardSkipDraft = () => {
    const parsedSeconds = Number.parseInt(forwardSkipDraft.trim(), 10);
    if (Number.isNaN(parsedSeconds)) {
      setForwardSkipDraft(String(seekForwardSeconds));
      return;
    }
    setSeekForwardSeconds(parsedSeconds);
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
                value={backwardSkipDraft}
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
                value={forwardSkipDraft}
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
            Lock screen forward and backward see will use Backward value.
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
