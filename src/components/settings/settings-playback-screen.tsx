import {
  type BookProgressTimeDisplay,
  DEFAULT_REMOTE_COMMAND_MODE,
  MAX_SKIP_SECONDS,
  type RemoteCommandMode,
  useSettingsActions,
  useSettingsStore,
} from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import {
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
  foregroundStyle,
  frame,
  labelsHidden,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

const BOOK_PROGRESS_OPTIONS: { value: BookProgressTimeDisplay; label: string }[] = [
  { value: "elapsed", label: "Time Read" },
  { value: "remaining", label: "Time Left" },
];

const MINUTE_OPTIONS = Array.from(
  { length: Math.floor(MAX_SKIP_SECONDS / 60) + 1 },
  (_, minute) => minute,
);
const SECOND_OPTIONS = Array.from({ length: 60 }, (_, second) => second);

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
  const [backwardSkipDraft, setBackwardSkipDraft] = useState<string | null>(null);
  const [forwardSkipDraft, setForwardSkipDraft] = useState<string | null>(null);
  const {
    setDefaultBookProgressTimeDisplay,
    setDisableLockScreenSeek,
    setRemoteCommandMode,
    setRestoreLastBookOnStartup,
    setSeekBackwardSeconds,
    setSeekForwardSeconds,
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
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const defaultBookProgressTimeDisplay = useSettingsStore(
    (state) => state.defaultBookProgressTimeDisplay,
  );
  const disableLockScreenSeek = useSettingsStore((state) => state.disableLockScreenSeek);
  const remoteCommandMode = useSettingsStore((state) => state.remoteCommandMode);
  const restoreLastBookOnStartup = useSettingsStore((state) => state.restoreLastBookOnStartup);
  const {
    setDefaultBookProgressTimeDisplay,
    setDisableLockScreenSeek,
    setRemoteCommandMode,
    setRestoreLastBookOnStartup,
    setSeekBackwardSeconds,
    setSeekForwardSeconds,
  } = useSettingsActions();
  const [isBackwardExpanded, setIsBackwardExpanded] = useState(false);
  const [isForwardExpanded, setIsForwardExpanded] = useState(false);

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
