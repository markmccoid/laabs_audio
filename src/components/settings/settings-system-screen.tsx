import {
  DEFAULT_REMOTE_COMMAND_MODE,
  type RemoteCommandMode,
  useSettingsActions,
  useSettingsStore,
} from "@/store/settings-store";
import {
  DEFAULT_LIGHT_ACCENT_COLOR,
  deriveDarkAccentFromLight,
  resolveAccentThemeColors,
} from "@/theme/accent-color";
import { useThemeColors } from "@/theme/use-app-theme";
import {
  Button,
  ColorPicker,
  DisclosureGroup,
  HStack,
  Host,
  List,
  Section,
  Spacer,
  Text as SwiftText,
  Toggle,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  bold,
  buttonStyle,
  foregroundStyle,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";

type AccentThemeCardProps = {
  label: string;
  accent: string;
  accentForeground: string;
  textColor: string;
  textMutedColor: string;
};

const AccentThemeCard = ({
  label,
  accent,
  accentForeground,
  textColor,
  textMutedColor,
}: AccentThemeCardProps) => (
  <View
    style={{
      borderRadius: 12,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: accent,
      padding: 12,
      gap: 10,
    }}
  >
    <Text selectable style={{ fontSize: 15, fontWeight: "700", color: textColor }}>
      {label}
    </Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
        style={{
          alignSelf: "flex-start",
          borderRadius: 999,
          borderCurve: "continuous",
          backgroundColor: accent,
          paddingHorizontal: 18,
          paddingVertical: 8,
        }}
      >
        <Text selectable style={{ color: accentForeground, fontSize: 13, fontWeight: "700" }}>
          {accent}
        </Text>
      </View>
    </View>
    <Text selectable style={{ fontSize: 12, color: textMutedColor }}>
      Editing accent colors is currently available on iOS.
    </Text>
  </View>
);

type AccentThemeEditorProps = {
  label: string;
  accent: string;
  accentForeground: string;
  onColorChange: (value: string) => void;
  onReset: () => void;
};

const AccentThemeEditor = ({
  label,
  accent,
  accentForeground,
  onColorChange,
  onReset,
}: AccentThemeEditorProps) => (
  <VStack spacing={8} alignment="leading">
    <SwiftText modifiers={[bold()]}>{label}</SwiftText>
    <HStack spacing={12} alignment="center">
      <SwiftText
        modifiers={[
          padding({ horizontal: 18, vertical: 8 }),
          foregroundStyle(accentForeground),
          background(
            accent,
            shapes.roundedRectangle({ cornerRadius: 10, roundedCornerStyle: "continuous" }),
          ),
        ]}
      >
        {accent}
      </SwiftText>
      <Spacer />
      <ColorPicker
        label=""
        selection={accent}
        supportsOpacity={false}
        onSelectionChange={onColorChange}
      />
    </HStack>
    <Button label="Reset to Default" onPress={onReset} modifiers={[buttonStyle("borderless")]} />
  </VStack>
);

const REMOTE_COMMAND_MODE_OPTIONS: {
  value: RemoteCommandMode;
  label: string;
  description: string;
}[] = [
  {
    value: DEFAULT_REMOTE_COMMAND_MODE,
    label: "Skip intervals",
    description: "Show skip forward and backward controls.",
  },
  {
    value: "next-prev",
    label: "Chapters",
    description: "Show next and previous controls for chapter navigation.",
  },
  {
    value: "none",
    label: "None",
    description: "Hide secondary playback controls.",
  },
];

const SystemSettingsFallback = () => {
  const themeColors = useThemeColors();
  const useTokenWithCoverImages = useSettingsStore((state) => state.useTokenWithCoverImages);
  const disableLockScreenSeek = useSettingsStore((state) => state.disableLockScreenSeek);
  const remoteCommandMode = useSettingsStore((state) => state.remoteCommandMode);
  const showFavoriteBadgeOnCovers = useSettingsStore((state) => state.showFavoriteBadgeOnCovers);
  const showFinishedBadgeOnCovers = useSettingsStore((state) => state.showFinishedBadgeOnCovers);
  const lightAccentColorOverride = useSettingsStore((state) => state.lightAccentColorOverride);
  const darkAccentColorOverride = useSettingsStore((state) => state.darkAccentColorOverride);
  const {
    setDisableLockScreenSeek,
    setRemoteCommandMode,
    setShowFavoriteBadgeOnCovers,
    setShowFinishedBadgeOnCovers,
    setUseTokenWithCoverImages,
  } = useSettingsActions();
  const lightAccentColors = resolveAccentThemeColors("light", lightAccentColorOverride);
  const darkAccentColors = resolveAccentThemeColors("dark", darkAccentColorOverride);

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
            Controls how the app requests covers and which badges appear on book art.
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
              gap: 12,
            }}
          >
            {[
              {
                title: "Use token with cover images",
                subtitle:
                  "When off, the app tries public cover URLs first and only retries with a token if needed.",
                value: useTokenWithCoverImages,
                onChange: setUseTokenWithCoverImages,
              },
              {
                title: "Show favorite badge",
                subtitle: "Displays a heart on cover art for books tagged as favorites.",
                value: showFavoriteBadgeOnCovers,
                onChange: setShowFavoriteBadgeOnCovers,
              },
              {
                title: "Show read badge",
                subtitle: "Displays a checkmark on cover art for finished books.",
                value: showFinishedBadgeOnCovers,
                onChange: setShowFinishedBadgeOnCovers,
              },
            ].map((item) => (
              <View
                key={item.title}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    selectable
                    style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                  >
                    {item.title}
                  </Text>
                  <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                    {item.subtitle}
                  </Text>
                </View>
                <Switch
                  value={item.value}
                  onValueChange={item.onChange}
                  trackColor={{ false: themeColors.border, true: themeColors.accent }}
                  thumbColor={item.value ? themeColors.accentForeground : "#f4f4f5"}
                />
              </View>
            ))}
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
            Playback Controls
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
                Remote command mode
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
                          color: isSelected
                            ? themeColors.accentForeground
                            : themeColors.text,
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
            gap: 12,
            backgroundColor: themeColors.surface,
          }}
        >
          <Text selectable style={{ color: themeColors.text, fontSize: 17, fontWeight: "700" }}>
            Accent Color
          </Text>
          <AccentThemeCard
            label="Light Mode"
            accent={lightAccentColors.accent}
            accentForeground={lightAccentColors.accentForeground}
            textColor={themeColors.text}
            textMutedColor={themeColors.textMuted}
          />
          <AccentThemeCard
            label="Dark Mode"
            accent={darkAccentColors.accent}
            accentForeground={darkAccentColors.accentForeground}
            textColor={themeColors.text}
            textMutedColor={themeColors.textMuted}
          />
        </View>
      </ScrollView>
    </View>
  );
};

export const SettingsSystemScreen = () => {
  const useTokenWithCoverImages = useSettingsStore((state) => state.useTokenWithCoverImages);
  const disableLockScreenSeek = useSettingsStore((state) => state.disableLockScreenSeek);
  const remoteCommandMode = useSettingsStore((state) => state.remoteCommandMode);
  const showFavoriteBadgeOnCovers = useSettingsStore((state) => state.showFavoriteBadgeOnCovers);
  const showFinishedBadgeOnCovers = useSettingsStore((state) => state.showFinishedBadgeOnCovers);
  const autoCreateDarkAccent = useSettingsStore((state) => state.autoCreateDarkAccent);
  const lightAccentColorOverride = useSettingsStore((state) => state.lightAccentColorOverride);
  const darkAccentColorOverride = useSettingsStore((state) => state.darkAccentColorOverride);
  const {
    setAutoCreateDarkAccent,
    setDisableLockScreenSeek,
    setRemoteCommandMode,
    resetDarkAccentColorOverride,
    resetLightAccentColorOverride,
    setDarkAccentColorOverride,
    setLightAccentColorOverride,
    setShowFavoriteBadgeOnCovers,
    setShowFinishedBadgeOnCovers,
    setUseTokenWithCoverImages,
  } = useSettingsActions();
  const [isCoverImagesExpanded, setIsCoverImagesExpanded] = useState(false);
  const [isCoverBadgesExpanded, setIsCoverBadgesExpanded] = useState(false);
  const [isAccentColorExpanded, setIsAccentColorExpanded] = useState(false);
  const lightAccentColors = resolveAccentThemeColors("light", lightAccentColorOverride);
  const darkAccentColors = resolveAccentThemeColors("dark", darkAccentColorOverride);

  const handleLightAccentChange = (value: string) => {
    if (value === lightAccentColors.accent) {
      return;
    }

    setLightAccentColorOverride(value);
    if (autoCreateDarkAccent) {
      setDarkAccentColorOverride(deriveDarkAccentFromLight(value));
    }
  };

  const handleAutoCreateDarkAccentChange = (enabled: boolean) => {
    setAutoCreateDarkAccent(enabled);
    if (enabled) {
      setDarkAccentColorOverride(deriveDarkAccentFromLight(lightAccentColors.accent));
    }
  };

  const handleLightAccentReset = () => {
    resetLightAccentColorOverride();
    if (autoCreateDarkAccent) {
      setDarkAccentColorOverride(deriveDarkAccentFromLight(DEFAULT_LIGHT_ACCENT_COLOR));
    }
  };

  if (Platform.OS !== "ios") {
    return <SystemSettingsFallback />;
  }

  return (
    <Host style={{ flex: 1 }}>
      <List>
        <Section title="Display">
          <DisclosureGroup
            label="Cover Images"
            isExpanded={isCoverImagesExpanded}
            onIsExpandedChange={setIsCoverImagesExpanded}
          >
            <SwiftText>Choose how the app requests cover art from Audiobookshelf.</SwiftText>
            <Toggle isOn={useTokenWithCoverImages} onIsOnChange={setUseTokenWithCoverImages}>
              <SwiftText>Use token with cover images</SwiftText>
              <SwiftText>
                Try public cover URLs first, then retry with a token only when needed.
              </SwiftText>
            </Toggle>
          </DisclosureGroup>

          <DisclosureGroup
            label="Cover Badges"
            isExpanded={isCoverBadgesExpanded}
            onIsExpandedChange={setIsCoverBadgesExpanded}
          >
            <SwiftText>Show or hide the status badges drawn on top of book covers.</SwiftText>
            <Toggle isOn={showFavoriteBadgeOnCovers} onIsOnChange={setShowFavoriteBadgeOnCovers}>
              <SwiftText>Show favorite badge</SwiftText>
              <SwiftText>Display a heart for books marked as favorites.</SwiftText>
            </Toggle>
            <Toggle isOn={showFinishedBadgeOnCovers} onIsOnChange={setShowFinishedBadgeOnCovers}>
              <SwiftText>Show read badge</SwiftText>
              <SwiftText>Display a checkmark for finished books.</SwiftText>
            </Toggle>
          </DisclosureGroup>

          <DisclosureGroup
            label="Accent Color"
            isExpanded={isAccentColorExpanded}
            onIsExpandedChange={setIsAccentColorExpanded}
          >
            <VStack spacing={16} alignment="leading">
              <Toggle isOn={autoCreateDarkAccent} onIsOnChange={handleAutoCreateDarkAccentChange}>
                <SwiftText>Auto create Dark</SwiftText>
              </Toggle>
              <AccentThemeEditor
                label="Light Mode"
                accent={lightAccentColors.accent}
                accentForeground={lightAccentColors.accentForeground}
                onColorChange={handleLightAccentChange}
                onReset={handleLightAccentReset}
              />
              <AccentThemeEditor
                label="Dark Mode"
                accent={darkAccentColors.accent}
                accentForeground={darkAccentColors.accentForeground}
                onColorChange={setDarkAccentColorOverride}
                onReset={resetDarkAccentColorOverride}
              />
            </VStack>
          </DisclosureGroup>
        </Section>

        <Section title="Playback Controls">
          <VStack spacing={8} alignment="leading">
            <SwiftText modifiers={[bold()]}>Remote command mode</SwiftText>
            {REMOTE_COMMAND_MODE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                label={`${option.label}${remoteCommandMode === option.value ? " (Current)" : ""}`}
                onPress={() => setRemoteCommandMode(option.value)}
                modifiers={[buttonStyle("borderless")]}
              />
            ))}
            <SwiftText>
              {
                REMOTE_COMMAND_MODE_OPTIONS.find(
                  (option) => option.value === remoteCommandMode,
                )?.description
              }
            </SwiftText>
          </VStack>
          <Toggle isOn={disableLockScreenSeek} onIsOnChange={setDisableLockScreenSeek}>
            <SwiftText>Disable lock screen seek</SwiftText>
            <SwiftText>Prevent scrubbing from Lock Screen and Now Playing controls.</SwiftText>
          </Toggle>
        </Section>
      </List>
    </Host>
  );
};
