import {
  type BookProgressTimeDisplay,
  DEFAULT_REMOTE_COMMAND_MODE,
  MAX_SKIP_SECONDS,
  PLAYBACK_RATE_RANGE_OPTIONS,
  type RemoteCommandMode,
  useSettingsActions,
  useSettingsStore,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  Button,
  DisclosureGroup,
  HStack,
  Host,
  Image,
  List,
  Picker,
  Section,
  Spacer,
  Text as SwiftText,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  foregroundStyle,
  frame,
  labelsHidden,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import { useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  MAX_AUTO_REWIND_RULES,
  MAX_AUTO_REWIND_SECONDS,
  MAX_AUTO_REWIND_THRESHOLD_MINUTES,
  MIN_AUTO_REWIND_SECONDS,
  type AutoRewindRule,
} from "@/player/auto-rewind";
import { deviceBooksStore } from "@/store/device-books-store";

const BOOK_PROGRESS_OPTIONS: { value: BookProgressTimeDisplay; label: string }[] = [
  { value: "elapsed", label: "Time Read" },
  { value: "remaining", label: "Time Left" },
];

const MINUTE_OPTIONS = Array.from(
  { length: Math.floor(MAX_SKIP_SECONDS / 60) + 1 },
  (_, minute) => minute,
);
const SECOND_OPTIONS = Array.from({ length: 60 }, (_, second) => second);
const AUTO_REWIND_THRESHOLD_OPTIONS = Array.from(
  { length: MAX_AUTO_REWIND_THRESHOLD_MINUTES + 1 },
  (_, minute) => minute,
);
const AUTO_REWIND_SECOND_OPTIONS = Array.from(
  { length: MAX_AUTO_REWIND_SECONDS - MIN_AUTO_REWIND_SECONDS + 1 },
  (_, index) => MIN_AUTO_REWIND_SECONDS + index,
);

const animateAutoRewindRuleSort = () => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
};

const REMOTE_COMMAND_MODE_OPTIONS: {
  value: RemoteCommandMode;
  label: string;
  description: string;
}[] = [
  {
    value: DEFAULT_REMOTE_COMMAND_MODE,
    label: "Skip by Seconds",
    description: "Show skip forward and backward controls.",
  },
  {
    value: "next-prev",
    label: "Skip by Chapters",
    description: "Show next and previous controls for chapter navigation.",
  },
  {
    value: "none",
    label: "None",
    description: "Hide secondary playback controls.",
  },
];

const formatSkipDuration = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatPlaybackRate = (rate: number) => `${Number(rate.toFixed(2))}x`;

type SkipDurationRowProps = {
  title: string;
  systemImage: SFSymbol;
  totalSeconds: number;
  isExpanded: boolean;
  onIsExpandedChange: (isExpanded: boolean) => void;
  onChange: (seconds: number) => void;
};

const SkipDurationRow = ({
  title,
  systemImage,
  totalSeconds,
  isExpanded,
  onIsExpandedChange,
  onChange,
}: SkipDurationRowProps) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <DisclosureGroup isExpanded={isExpanded} onIsExpandedChange={onIsExpandedChange}>
      <DisclosureGroup.Label>
        <HStack spacing={10} alignment="center">
          <Image systemName={systemImage} />
          <SwiftText>{title}</SwiftText>
          <Spacer />
          <SwiftText modifiers={[foregroundStyle({ type: "hierarchical", style: "secondary" })]}>
            {formatSkipDuration(totalSeconds)}
          </SwiftText>
        </HStack>
      </DisclosureGroup.Label>

      <HStack spacing={0} alignment="center">
        <Picker
          label="Minutes"
          selection={minutes}
          onSelectionChange={(nextMinutes) => onChange(nextMinutes * 60 + seconds)}
          modifiers={[pickerStyle("wheel"), labelsHidden(), frame({ maxWidth: 150, height: 140 })]}
        >
          {MINUTE_OPTIONS.map((minute) => (
            <SwiftText key={minute} modifiers={[tag(minute)]}>
              {`${minute} min`}
            </SwiftText>
          ))}
        </Picker>
        <Picker
          label="Seconds"
          selection={seconds}
          onSelectionChange={(nextSeconds) => onChange(minutes * 60 + nextSeconds)}
          modifiers={[pickerStyle("wheel"), labelsHidden(), frame({ maxWidth: 150, height: 140 })]}
        >
          {SECOND_OPTIONS.map((second) => (
            <SwiftText key={second} modifiers={[tag(second)]}>
              {`${second} sec`}
            </SwiftText>
          ))}
        </Picker>
      </HStack>
    </DisclosureGroup>
  );
};

const getAvailableAutoRewindThresholds = (rules: AutoRewindRule[], index: number) => {
  const currentThreshold = rules[index]?.thresholdMinutes;
  const usedByOtherRules = new Set(
    rules
      .filter((_, ruleIndex) => ruleIndex !== index)
      .map((rule) => rule.thresholdMinutes),
  );
  return AUTO_REWIND_THRESHOLD_OPTIONS.filter(
    (threshold) => threshold === currentThreshold || !usedByOtherRules.has(threshold),
  );
};

type AutoRewindRulePickerRowProps = {
  rule: AutoRewindRule;
  index: number;
  rules: AutoRewindRule[];
  isExpanded: boolean;
  onIsExpandedChange: (isExpanded: boolean) => void;
  onChange: (index: number, rule: AutoRewindRule) => void;
  onRemove: (index: number) => void;
};

const AutoRewindRulePickerRow = ({
  rule,
  index,
  rules,
  isExpanded,
  onIsExpandedChange,
  onChange,
  onRemove,
}: AutoRewindRulePickerRowProps) => {
  const thresholdOptions = isExpanded ? getAvailableAutoRewindThresholds(rules, index) : [];

  return (
    <DisclosureGroup isExpanded={isExpanded} onIsExpandedChange={onIsExpandedChange}>
      <DisclosureGroup.Label>
        <HStack spacing={10} alignment="center">
          <Image systemName="gobackward" />
          <SwiftText>{`After ${rule.thresholdMinutes} min`}</SwiftText>
          <Spacer />
          <SwiftText modifiers={[foregroundStyle({ type: "hierarchical", style: "secondary" })]}>
            {`${rule.rewindSeconds} sec`}
          </SwiftText>
        </HStack>
      </DisclosureGroup.Label>

      {isExpanded ? (
        <>
          <HStack spacing={0} alignment="center">
            <Picker
              label="After"
              selection={rule.thresholdMinutes}
              onSelectionChange={(thresholdMinutes) =>
                onChange(index, { ...rule, thresholdMinutes })
              }
              modifiers={[
                pickerStyle("wheel"),
                labelsHidden(),
                frame({ maxWidth: 160, height: 140 }),
              ]}
            >
              {thresholdOptions.map((minute) => (
                <SwiftText key={minute} modifiers={[tag(minute)]}>
                  {`${minute} min`}
                </SwiftText>
              ))}
            </Picker>
            <Picker
              label="Rewind"
              selection={rule.rewindSeconds}
              onSelectionChange={(rewindSeconds) => onChange(index, { ...rule, rewindSeconds })}
              modifiers={[
                pickerStyle("wheel"),
                labelsHidden(),
                frame({ maxWidth: 150, height: 140 }),
              ]}
            >
              {AUTO_REWIND_SECOND_OPTIONS.map((second) => (
                <SwiftText key={second} modifiers={[tag(second)]}>
                  {`${second} sec`}
                </SwiftText>
              ))}
            </Picker>
          </HStack>
          <Button
            label="Delete Rule"
            onPress={() => onRemove(index)}
            modifiers={[buttonStyle("borderless")]}
          />
        </>
      ) : null}
    </DisclosureGroup>
  );
};

type AutoRewindFallbackRuleRowProps = {
  rule: AutoRewindRule;
  index: number;
  rules: AutoRewindRule[];
  onChange: (index: number, rule: AutoRewindRule) => void;
  onSortRules: () => void;
  onRemove: (index: number) => void;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  bgColor: string;
  surfaceColor: string;
};

const AutoRewindFallbackRuleRow = ({
  rule,
  index,
  rules,
  onChange,
  onSortRules,
  onRemove,
  textColor,
  mutedColor,
  borderColor,
  bgColor,
  surfaceColor,
}: AutoRewindFallbackRuleRowProps) => {
  const commitThreshold = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const thresholdMinutes = Math.max(
      0,
      Math.min(MAX_AUTO_REWIND_THRESHOLD_MINUTES, Math.round(parsed)),
    );
    const duplicate = rules.some(
      (candidate, ruleIndex) =>
        ruleIndex !== index && candidate.thresholdMinutes === thresholdMinutes,
    );
    if (duplicate) return;
    onChange(index, { ...rule, thresholdMinutes });
    animateAutoRewindRuleSort();
    onSortRules();
  };

  const commitSeconds = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const rewindSeconds = Math.max(
      MIN_AUTO_REWIND_SECONDS,
      Math.min(MAX_AUTO_REWIND_SECONDS, Math.round(parsed)),
    );
    onChange(index, { ...rule, rewindSeconds });
  };

  return (
    <View
      style={{
        borderRadius: 12,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor,
        backgroundColor: bgColor,
        padding: 10,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text selectable style={{ color: textColor, fontSize: 14, fontWeight: "700", flex: 1 }}>
          {`After ${rule.thresholdMinutes} min -> ${rule.rewindSeconds} sec`}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onRemove(index)}
          style={({ pressed }) => ({
            borderRadius: 9,
            borderCurve: "continuous",
            backgroundColor: surfaceColor,
            borderWidth: 1,
            borderColor,
            paddingHorizontal: 10,
            paddingVertical: 7,
            opacity: pressed ? 0.78 : 1,
          })}
        >
          <Text selectable style={{ color: textColor, fontSize: 12, fontWeight: "700" }}>
            Delete
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text selectable style={{ color: mutedColor, fontSize: 12 }}>
            After minutes
          </Text>
          <TextInput
            defaultValue={String(rule.thresholdMinutes)}
            onEndEditing={(event) => commitThreshold(event.nativeEvent.text)}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            style={{
              minHeight: 38,
              borderRadius: 10,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor,
              backgroundColor: surfaceColor,
              color: textColor,
              fontSize: 15,
              paddingHorizontal: 10,
              paddingVertical: 8,
            }}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text selectable style={{ color: mutedColor, fontSize: 12 }}>
            Rewind seconds
          </Text>
          <TextInput
            defaultValue={String(rule.rewindSeconds)}
            onEndEditing={(event) => commitSeconds(event.nativeEvent.text)}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={3}
            style={{
              minHeight: 38,
              borderRadius: 10,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor,
              backgroundColor: surfaceColor,
              color: textColor,
              fontSize: 15,
              paddingHorizontal: 10,
              paddingVertical: 8,
            }}
          />
        </View>
      </View>
      <Text selectable style={{ color: mutedColor, fontSize: 11 }}>
        Each minute threshold can only be used once.
      </Text>
    </View>
  );
};

const PlaybackSettingsFallback = () => {
  const themeColors = useThemeColors();
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const defaultBookProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const disableLockScreenSeek = useSettingsStore((state) => state.disableLockScreenSeek);
  const remoteCommandMode = useSettingsStore((state) => state.remoteCommandMode);
  const restoreLastBookOnStartup = useSettingsStore((state) => state.restoreLastBookOnStartup);
  const openPlayerOnPlaybackStart = useSettingsStore((state) => state.openPlayerOnPlaybackStart);
  const autoRewindEnabled = useSettingsStore((state) => state.autoRewindEnabled);
  const autoRewindRules = useSettingsStore((state) => state.autoRewindRules);
  const autoRewindLimitToChapter = useSettingsStore(
    (state) => state.autoRewindLimitToChapter,
  );
  const [backwardSkipDraft, setBackwardSkipDraft] = useState<string | null>(null);
  const [forwardSkipDraft, setForwardSkipDraft] = useState<string | null>(null);
  const {
    addAutoRewindRule,
    removeAutoRewindRule,
    setAutoRewindEnabled,
    setAutoRewindLimitToChapter,
    setDefaultBookProgressTimeDisplay,
    setDisableLockScreenSeek,
    setOpenPlayerOnPlaybackStart,
    setRemoteCommandMode,
    setRestoreLastBookOnStartup,
    setSeekBackwardSeconds,
    setSeekForwardSeconds,
    sortAutoRewindRules,
    updateAutoRewindRule,
  } = useSettingsActions();
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

  const handleAutoRewindEnabledChange = (enabled: boolean) => {
    if (!enabled) {
      deviceBooksStore.getState().actions.clearAllListeningInterruptions();
    }
    setAutoRewindEnabled(enabled);
  };

  const handleRemoveAutoRewindRule = (index: number) => {
    if (autoRewindRules.length <= 1) {
      deviceBooksStore.getState().actions.clearAllListeningInterruptions();
    }
    removeAutoRewindRule(index);
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
            Startup
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                Restore last book on startup
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                Reopen the app with your last book loaded and paused where you left off. It never
                starts playing on its own.
              </Text>
            </View>
            <Switch
              value={restoreLastBookOnStartup}
              onValueChange={setRestoreLastBookOnStartup}
              trackColor={{ false: themeColors.border, true: themeColors.accent }}
              thumbColor={restoreLastBookOnStartup ? themeColors.accentForeground : "#f4f4f5"}
            />
          </View>
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
            Player Screen
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                Open player when playback starts
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                Starting a book from its detail screen opens the full player. Turn this off to stay
                on the book and use the mini player instead.
              </Text>
            </View>
            <Switch
              value={openPlayerOnPlaybackStart}
              onValueChange={setOpenPlayerOnPlaybackStart}
              trackColor={{ false: themeColors.border, true: themeColors.accent }}
              thumbColor={openPlayerOnPlaybackStart ? themeColors.accentForeground : "#f4f4f5"}
            />
          </View>
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
            Skip Time Seconds
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
            Lock Screen Controls
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Controls how system playback surfaces behave outside the app.
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
              gap: 10,
            }}
          >
            <View style={{ gap: 8 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                Options
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {REMOTE_COMMAND_MODE_OPTIONS.map((option) => {
                  const isSelected = remoteCommandMode === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setRemoteCommandMode(option.value)}
                      style={({ pressed }) => ({
                        minHeight: 38,
                        borderRadius: 10,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: isSelected ? themeColors.accent : themeColors.border,
                        backgroundColor: isSelected ? themeColors.accent : themeColors.surface,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <Text
                        selectable
                        style={{
                          color: isSelected ? themeColors.accentForeground : themeColors.text,
                          fontSize: 13,
                          fontWeight: "700",
                        }}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                {
                  REMOTE_COMMAND_MODE_OPTIONS.find(
                    (option) => option.value === remoteCommandMode,
                  )?.description
                }
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: themeColors.border }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                >
                  Disable lock screen seek
                </Text>
                <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                  Prevents scrubbing from Lock Screen and Now Playing controls.
                </Text>
              </View>
              <Switch
                value={disableLockScreenSeek}
                onValueChange={setDisableLockScreenSeek}
                trackColor={{ false: themeColors.border, true: themeColors.accent }}
                thumbColor={disableLockScreenSeek ? themeColors.accentForeground : "#f4f4f5"}
              />
            </View>
          </View>
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
            Auto Rewind
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            Automatically skip back when you return to a book after being away.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                Rewind on resume
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                Uses the largest matching rule when playback resumes.
              </Text>
            </View>
            <Switch
              value={autoRewindEnabled}
              onValueChange={handleAutoRewindEnabledChange}
              trackColor={{ false: themeColors.border, true: themeColors.accent }}
              thumbColor={autoRewindEnabled ? themeColors.accentForeground : "#f4f4f5"}
            />
          </View>

          {autoRewindEnabled ? (
            <>
              <View style={{ gap: 8 }}>
                {autoRewindRules.map((rule, index) => (
                  <AutoRewindFallbackRuleRow
                    key={`auto-rewind-${rule.thresholdMinutes}`}
                    rule={rule}
                    index={index}
                    rules={autoRewindRules}
                    onChange={updateAutoRewindRule}
                    onSortRules={sortAutoRewindRules}
                    onRemove={handleRemoveAutoRewindRule}
                    textColor={themeColors.text}
                    mutedColor={themeColors.textMuted}
                    borderColor={themeColors.border}
                    bgColor={themeColors.bg}
                    surfaceColor={themeColors.surface}
                  />
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: autoRewindRules.length >= MAX_AUTO_REWIND_RULES }}
                disabled={autoRewindRules.length >= MAX_AUTO_REWIND_RULES}
                onPress={() => addAutoRewindRule()}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  borderRadius: 10,
                  borderCurve: "continuous",
                  backgroundColor: themeColors.accent,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  opacity:
                    autoRewindRules.length >= MAX_AUTO_REWIND_RULES ? 0.45 : pressed ? 0.78 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: themeColors.accentForeground,
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  Add Rule
                </Text>
              </Pressable>
              <View style={{ height: 1, backgroundColor: themeColors.border }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    selectable
                    style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                  >
                    Limit to chapter
                  </Text>
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                    Do not rewind before the current chapter start when chapters are available.
                  </Text>
                </View>
                <Switch
                  value={autoRewindLimitToChapter}
                  onValueChange={setAutoRewindLimitToChapter}
                  trackColor={{ false: themeColors.border, true: themeColors.accent }}
                  thumbColor={autoRewindLimitToChapter ? themeColors.accentForeground : "#f4f4f5"}
                />
              </View>
            </>
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
            {BOOK_PROGRESS_OPTIONS.map((option) => {
              const isSelected = defaultBookProgressTimeDisplay === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setDefaultBookProgressTimeDisplay(option.value)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: isSelected ? themeColors.accent : themeColors.border,
                    backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
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
                      color: isSelected ? themeColors.accentForeground : themeColors.text,
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
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

export const SettingsPlaybackScreen = () => {
  const playbackRateRangeMin = useSettingsStore((state) => state.playbackRateRangeMin);
  const playbackRateRangeMax = useSettingsStore((state) => state.playbackRateRangeMax);
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const defaultBookProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const disableLockScreenSeek = useSettingsStore((state) => state.disableLockScreenSeek);
  const remoteCommandMode = useSettingsStore((state) => state.remoteCommandMode);
  const restoreLastBookOnStartup = useSettingsStore((state) => state.restoreLastBookOnStartup);
  const openPlayerOnPlaybackStart = useSettingsStore((state) => state.openPlayerOnPlaybackStart);
  const autoRewindEnabled = useSettingsStore((state) => state.autoRewindEnabled);
  const autoRewindRules = useSettingsStore((state) => state.autoRewindRules);
  const autoRewindLimitToChapter = useSettingsStore(
    (state) => state.autoRewindLimitToChapter,
  );
  const {
    addAutoRewindRule,
    removeAutoRewindRule,
    setAutoRewindEnabled,
    setAutoRewindLimitToChapter,
    setDefaultBookProgressTimeDisplay,
    setDisableLockScreenSeek,
    setOpenPlayerOnPlaybackStart,
    setPlaybackRateRangeMax,
    setPlaybackRateRangeMin,
    setRemoteCommandMode,
    setRestoreLastBookOnStartup,
    setSeekBackwardSeconds,
    setSeekForwardSeconds,
    sortAutoRewindRules,
    updateAutoRewindRule,
  } = useSettingsActions();
  const [isBackwardExpanded, setIsBackwardExpanded] = useState(false);
  const [isForwardExpanded, setIsForwardExpanded] = useState(false);
  const [expandedAutoRewindRuleIndex, setExpandedAutoRewindRuleIndex] = useState<number | null>(
    null,
  );
  const handleAutoRewindEnabledChange = (enabled: boolean) => {
    if (!enabled) {
      deviceBooksStore.getState().actions.clearAllListeningInterruptions();
    }
    setAutoRewindEnabled(enabled);
  };
  const handleRemoveAutoRewindRule = (index: number) => {
    if (autoRewindRules.length <= 1) {
      deviceBooksStore.getState().actions.clearAllListeningInterruptions();
    }
    setExpandedAutoRewindRuleIndex(null);
    removeAutoRewindRule(index);
  };
  const sortAutoRewindRulesWithAnimation = () => {
    animateAutoRewindRuleSort();
    sortAutoRewindRules();
  };
  const handleAutoRewindRuleExpansionChange = (index: number, isExpanded: boolean) => {
    setExpandedAutoRewindRuleIndex((currentIndex) => {
      if (isExpanded) {
        if (currentIndex !== null && currentIndex !== index) {
          sortAutoRewindRulesWithAnimation();
        }
        return index;
      }
      if (currentIndex === index) {
        sortAutoRewindRulesWithAnimation();
        return null;
      }
      return currentIndex;
    });
  };
  const minPlaybackRateOptions = PLAYBACK_RATE_RANGE_OPTIONS.filter(
    (rate) => rate <= playbackRateRangeMax,
  );
  const maxPlaybackRateOptions = PLAYBACK_RATE_RANGE_OPTIONS.filter(
    (rate) => rate >= playbackRateRangeMin,
  );

  if (Platform.OS !== "ios") {
    return <PlaybackSettingsFallback />;
  }

  return (
    <Host style={{ flex: 1 }}>
      <List>
        <Section
          title="Startup"
          footer={
            <SwiftText>
              When you reopen the app, your last book is loaded and ready, paused where you left
              off. It never starts playing on its own.
            </SwiftText>
          }
        >
          <Toggle isOn={restoreLastBookOnStartup} onIsOnChange={setRestoreLastBookOnStartup}>
            <SwiftText>Restore last book on startup</SwiftText>
          </Toggle>
        </Section>

        <Section
          title="Player Screen"
          footer={
            <SwiftText>
              Starting a book from its detail screen opens the full player. Turn this off to stay on
              the book and use the mini player instead.
            </SwiftText>
          }
        >
          <Toggle isOn={openPlayerOnPlaybackStart} onIsOnChange={setOpenPlayerOnPlaybackStart}>
            <SwiftText>Open player when playback starts</SwiftText>
          </Toggle>
        </Section>

        <Section
          title="Playback Rate"
          footer={
            <SwiftText>
              Player speed controls only offer speeds in this range. Saved audiobook speeds outside
              the range move to the closest boundary.
            </SwiftText>
          }
        >
          <Picker
            label="Minimum Speed"
            selection={playbackRateRangeMin}
            onSelectionChange={setPlaybackRateRangeMin as any}
            modifiers={[pickerStyle("menu")]}
          >
            {minPlaybackRateOptions.map((rate) => (
              <SwiftText key={`min-rate-${rate}`} modifiers={[tag(rate)]}>
                {formatPlaybackRate(rate)}
              </SwiftText>
            ))}
          </Picker>
          <Picker
            label="Maximum Speed"
            selection={playbackRateRangeMax}
            onSelectionChange={setPlaybackRateRangeMax as any}
            modifiers={[pickerStyle("menu")]}
          >
            {maxPlaybackRateOptions.map((rate) => (
              <SwiftText key={`max-rate-${rate}`} modifiers={[tag(rate)]}>
                {formatPlaybackRate(rate)}
              </SwiftText>
            ))}
          </Picker>
        </Section>

        <Section
          title="Skip Intervals"
          footer={
            <SwiftText>
              Lock screen skip controls use these matching forward and backward values.
            </SwiftText>
          }
        >
          <SkipDurationRow
            title="Skip Back"
            systemImage="gobackward"
            totalSeconds={seekBackwardSeconds}
            isExpanded={isBackwardExpanded}
            onIsExpandedChange={setIsBackwardExpanded}
            onChange={setSeekBackwardSeconds}
          />
          <SkipDurationRow
            title="Skip Forward"
            systemImage="goforward"
            totalSeconds={seekForwardSeconds}
            isExpanded={isForwardExpanded}
            onIsExpandedChange={setIsForwardExpanded}
            onChange={setSeekForwardSeconds}
          />
        </Section>

        <Section title="Lock Screen Controls">
          <Picker
            label="Options"
            selection={remoteCommandMode}
            onSelectionChange={setRemoteCommandMode as any}
            modifiers={[pickerStyle("menu")]}
          >
            {REMOTE_COMMAND_MODE_OPTIONS.map((option) => (
              <SwiftText key={option.value} modifiers={[tag(option.value)]}>
                {option.label}
              </SwiftText>
            ))}
          </Picker>
          <Toggle isOn={disableLockScreenSeek} onIsOnChange={setDisableLockScreenSeek}>
            <SwiftText>Disable lock screen seek</SwiftText>
            <SwiftText>Prevent scrubbing from Lock Screen and Now Playing controls.</SwiftText>
          </Toggle>
        </Section>

        <Section
          title="Auto Rewind"
          footer={
            <SwiftText>
              Automatically skip back when you return to a book after being away. The largest
              matching rule is applied before playback starts.
            </SwiftText>
          }
        >
          <Toggle isOn={autoRewindEnabled} onIsOnChange={handleAutoRewindEnabledChange}>
            <SwiftText>Rewind on resume</SwiftText>
          </Toggle>
          {autoRewindEnabled
            ? autoRewindRules.map((rule, index) => (
                <AutoRewindRulePickerRow
                  key={`auto-rewind-${rule.thresholdMinutes}`}
                  rule={rule}
                  index={index}
                  rules={autoRewindRules}
                  isExpanded={expandedAutoRewindRuleIndex === index}
                  onIsExpandedChange={(isExpanded) =>
                    handleAutoRewindRuleExpansionChange(index, isExpanded)
                  }
                  onChange={updateAutoRewindRule}
                  onRemove={handleRemoveAutoRewindRule}
                />
              ))
            : null}
          {autoRewindEnabled ? (
            <Button
              label="Add Rule"
              onPress={() => addAutoRewindRule()}
              modifiers={[
                buttonStyle("borderless"),
                disabled(autoRewindRules.length >= MAX_AUTO_REWIND_RULES),
              ]}
            />
          ) : null}
          {autoRewindEnabled ? (
            <Toggle
              isOn={autoRewindLimitToChapter}
              onIsOnChange={setAutoRewindLimitToChapter}
            >
              <SwiftText>Limit to current chapter</SwiftText>
            </Toggle>
          ) : null}
        </Section>

        <Section
          title="Book Progress Display"
          footer={
            <SwiftText>
              Sets the default view in Book details. You can still tap the value on a book to
              switch — it resets to this default each time you open a book.
            </SwiftText>
          }
        >
          <Picker
            label="Default"
            selection={defaultBookProgressTimeDisplay}
            onSelectionChange={(selection) =>
              setDefaultBookProgressTimeDisplay(selection as BookProgressTimeDisplay)
            }
            modifiers={[pickerStyle("segmented")]}
          >
            {BOOK_PROGRESS_OPTIONS.map((option) => (
              <SwiftText key={option.value} modifiers={[tag(option.value)]}>
                {option.label}
              </SwiftText>
            ))}
          </Picker>
        </Section>
      </List>
    </Host>
  );
};
