import { usePlaybackStore, useSleepTimerActions, useSleepTimerStatus, useSleepTimerStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ADJUSTMENT_STEPS = [-15, -10, -5, 5, 10, 15];

const chapterModes = [
  {
    mode: "end_of_chapter" as const,
    title: "End of Chapter",
  },
  {
    mode: "end_of_next_chapter" as const,
    title: "End of Next Chapter",
  },
];

const formatAdjustmentLabel = (minutes: number) => (minutes > 0 ? `+${minutes}` : String(minutes));

const PlayerSleepTimerSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const actions = useSleepTimerActions();
  const draftMinutes = useSleepTimerStore((state) => state.draftMinutes);
  const customMinutePresets = useSleepTimerStore((state) => state.customMinutePresets);
  const activeTimer = useSleepTimerStore((state) => state.activeTimer);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const sleepTimerStatus = useSleepTimerStatus();
  const [newPresetDraft, setNewPresetDraft] = useState("");

  const isMinutesTimerActive = activeTimer?.mode === "minutes";
  const canSetChapterTimer = queueLength > 0;
  const isChapterTimerActive =
    activeTimer?.mode === "end_of_chapter" || activeTimer?.mode === "end_of_next_chapter";

  const minuteSummary = useMemo(() => {
    if (isMinutesTimerActive) return sleepTimerStatus.title;
    return `Sleep in ${draftMinutes} min`;
  }, [draftMinutes, isMinutesTimerActive, sleepTimerStatus.title]);

  const addPreset = () => {
    const parsed = Number.parseInt(newPresetDraft.trim(), 10);
    if (Number.isNaN(parsed)) return;
    actions.addCustomPreset(parsed);
    setNewPresetDraft("");
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: Math.max(16, insets.bottom + 8),
        gap: 12,
      }}
    >
      <Text selectable style={{ fontSize: 20, fontWeight: "700", color: themeColors.text }}>
        Sleep Timer
      </Text>

      <View
        style={{
          borderRadius: 18,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
          borderWidth: 1,
          borderColor: themeColors.border,
          paddingHorizontal: 12,
          paddingVertical: 12,
          gap: 10,
          boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
        }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {chapterModes.map((option) => {
            const isSelected = activeTimer?.mode === option.mode;
            return (
              <Pressable
                key={option.mode}
                accessibilityRole="button"
                accessibilityLabel={`Sleep timer ${option.title}`}
                disabled={!canSetChapterTimer}
                onPress={() => {
                  if (isSelected) {
                    actions.stopTimer();
                    return;
                  }
                  actions.startChapterTimer(option.mode);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: isSelected ? themeColors.accent : themeColors.border,
                  backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: !canSetChapterTimer ? 0.45 : pressed ? 0.8 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: isSelected ? themeColors.accentForeground : themeColors.text,
                  }}
                >
                  {option.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {customMinutePresets.map((minutes) => {
            const isSelected =
              !isChapterTimerActive &&
              ((isMinutesTimerActive && draftMinutes === minutes) || (!isMinutesTimerActive && draftMinutes === minutes));

            return (
              <Pressable
                key={`quick-${minutes}`}
                accessibilityRole="button"
                accessibilityLabel={`Start ${minutes} minute sleep timer`}
                onPress={() => {
                  actions.setDraftMinutes(minutes);
                  actions.startMinutesTimer(minutes);
                }}
                style={({ pressed }) => ({
                  borderRadius: 999,
                  borderCurve: "continuous",
                  minHeight: 34,
                  paddingHorizontal: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: isSelected ? themeColors.accent : themeColors.border,
                  backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    fontSize: 12,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                    color: isSelected ? themeColors.accentForeground : themeColors.text,
                  }}
                >
                  {minutes}m
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isChapterTimerActive ? (
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 11 }}>
            {sleepTimerStatus.subtitle}
          </Text>
        ) : null}

        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: themeColors.border,
            paddingTop: 10,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text
              selectable
              style={{
                color: themeColors.text,
                fontSize: 24,
                fontWeight: "700",
                fontVariant: ["tabular-nums"],
              }}
            >
              {minuteSummary}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isMinutesTimerActive ? "Stop minute sleep timer" : "Start minute sleep timer"}
              onPress={() => {
                if (isMinutesTimerActive) {
                  actions.stopTimer();
                  return;
                }
                actions.startMinutesTimer(draftMinutes);
              }}
              style={({ pressed }) => ({
                borderRadius: 14,
                borderCurve: "continuous",
                minHeight: 42,
                minWidth: 88,
                paddingHorizontal: 14,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: isMinutesTimerActive ? themeColors.border : themeColors.accent,
                backgroundColor: isMinutesTimerActive ? themeColors.bg : themeColors.accent,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                selectable
                style={{
                  fontSize: 14,
                  fontWeight: "700",
                  color: isMinutesTimerActive ? themeColors.text : themeColors.accentForeground,
                }}
              >
                {isMinutesTimerActive ? "Stop" : "Start"}
              </Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ADJUSTMENT_STEPS.map((step) => (
              <Pressable
                key={step}
                accessibilityRole="button"
                accessibilityLabel={`Adjust sleep timer by ${step} minutes`}
                onPress={() => actions.adjustMinutesBy(step)}
                style={({ pressed }) => ({
                  minWidth: "31%",
                  borderRadius: 12,
                  borderCurve: "continuous",
                  paddingVertical: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: themeColors.bg,
                  borderWidth: 1,
                  borderColor: themeColors.border,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: themeColors.text,
                    fontSize: 16,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatAdjustmentLabel(step)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <View
        style={{
          borderRadius: 18,
          borderCurve: "continuous",
          backgroundColor: themeColors.surface,
          borderWidth: 1,
          borderColor: themeColors.border,
          paddingHorizontal: 12,
          paddingVertical: 12,
          gap: 8,
        }}
      >
        <Text selectable style={{ fontSize: 15, fontWeight: "700", color: themeColors.text }}>
          Custom Times
        </Text>

        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {customMinutePresets.map((minutes) => (
            <View
              key={`custom-${minutes}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: themeColors.border,
                backgroundColor: themeColors.bg,
                overflow: "hidden",
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Start ${minutes} minute sleep timer`}
                onPress={() => {
                  actions.setDraftMinutes(minutes);
                  actions.startMinutesTimer(minutes);
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: themeColors.text,
                    fontSize: 12,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {minutes}m
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${minutes} minute preset`}
                onPress={() => actions.removeCustomPreset(minutes)}
                style={({ pressed }) => ({
                  paddingHorizontal: 7,
                  paddingVertical: 7,
                  borderLeftWidth: StyleSheet.hairlineWidth,
                  borderLeftColor: themeColors.border,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <SymbolView name="xmark" size={11} tintColor={themeColors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>

        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: themeColors.border,
            paddingTop: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <TextInput
            value={newPresetDraft}
            onChangeText={(value) => setNewPresetDraft(value.replace(/[^0-9]/g, ""))}
            placeholder="Minutes"
            keyboardType="number-pad"
            inputMode="numeric"
            returnKeyType="done"
            maxLength={3}
            onSubmitEditing={addPreset}
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: 10,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: themeColors.border,
              backgroundColor: themeColors.bg,
              color: themeColors.text,
              paddingHorizontal: 10,
              fontSize: 14,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add custom sleep timer preset"
            onPress={addPreset}
            style={({ pressed }) => ({
              borderRadius: 10,
              borderCurve: "continuous",
              minHeight: 38,
              paddingHorizontal: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: themeColors.accent,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text selectable style={{ color: themeColors.accentForeground, fontWeight: "700", fontSize: 13 }}>
              Add
            </Text>
          </Pressable>
        </View>

        {!canSetChapterTimer ? (
          <Text selectable style={{ fontSize: 11, color: themeColors.textMuted }}>
            Start playback to enable chapter-end timers.
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close sleep timer sheet"
        onPress={() => router.back()}
        style={({ pressed }) => ({
          borderRadius: 999,
          borderCurve: "continuous",
          paddingVertical: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.accent,
          opacity: pressed ? 0.82 : 1,
          marginTop: "auto",
        })}
      >
        <Text selectable style={{ color: themeColors.accentForeground, fontWeight: "700", fontSize: 14 }}>
          Close
        </Text>
      </Pressable>
    </ScrollView>
  );
};

export default PlayerSleepTimerSheet;
