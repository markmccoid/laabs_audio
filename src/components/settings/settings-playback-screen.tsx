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
  const skipTimeSeconds = seekForwardSeconds;
  const [skipTimeDraft, setSkipTimeDraft] = useState(() => String(skipTimeSeconds));
  const { setDefaultBookProgressTimeDisplay, setSkipSeconds } = useSettingsActions();

  useEffect(() => {
    setSkipTimeDraft(String(skipTimeSeconds));
  }, [skipTimeSeconds]);

  const commitSkipTimeDraft = () => {
    const parsedSeconds = Number.parseInt(skipTimeDraft.trim(), 10);
    if (Number.isNaN(parsedSeconds)) {
      setSkipTimeDraft(String(skipTimeSeconds));
      return;
    }
    setSkipSeconds(parsedSeconds);
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
            Skip Time
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Sets skip duration for both backward and forward controls.
          </Text>

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
            <TextInput
              value={skipTimeDraft}
              onChangeText={(nextValue) => setSkipTimeDraft(nextValue.replace(/[^0-9]/g, ""))}
              onBlur={commitSkipTimeDraft}
              onEndEditing={commitSkipTimeDraft}
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
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
              seconds
            </Text>
          </View>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 12, marginTop: 2 }}>
            Changing this value updates both forward and backward skip settings.
          </Text>
          {seekBackwardSeconds !== seekForwardSeconds ? (
            <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
              Forward/backward skip are currently different; saving this field will align them.
            </Text>
          ) : null}
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
