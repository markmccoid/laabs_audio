import {
  type BookProgressTimeDisplay,
  MAX_SKIP_SECONDS,
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
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

const BOOK_PROGRESS_OPTIONS: { value: BookProgressTimeDisplay; label: string }[] = [
  { value: "elapsed", label: "Time Read" },
  { value: "remaining", label: "Time Left" },
];

const MINUTE_OPTIONS = Array.from(
  { length: Math.floor(MAX_SKIP_SECONDS / 60) + 1 },
  (_, minute) => minute,
);
const SECOND_OPTIONS = Array.from({ length: 60 }, (_, second) => second);

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
  const { setDefaultBookProgressTimeDisplay, setSeekBackwardSeconds, setSeekForwardSeconds } =
    useSettingsActions();
  const [isBackwardExpanded, setIsBackwardExpanded] = useState(false);
  const [isForwardExpanded, setIsForwardExpanded] = useState(false);

  if (Platform.OS !== "ios") {
    return <PlaybackSettingsFallback />;
  }

  return (
    <Host style={{ flex: 1 }}>
      <List>
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
