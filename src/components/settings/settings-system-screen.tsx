import {
  DisclosureGroup,
  Host,
  List,
  Section,
  Text as SwiftText,
  Toggle,
} from "@expo/ui/swift-ui";
import { useSettingsActions, useSettingsStore } from "@/store/settings-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { useState } from "react";
import { Platform, ScrollView, Switch, Text, View } from "react-native";

const SystemSettingsFallback = () => {
  const themeColors = useThemeColors();
  const useTokenWithCoverImages = useSettingsStore((state) => state.useTokenWithCoverImages);
  const showFavoriteBadgeOnCovers = useSettingsStore((state) => state.showFavoriteBadgeOnCovers);
  const showFinishedBadgeOnCovers = useSettingsStore((state) => state.showFinishedBadgeOnCovers);
  const {
    setShowFavoriteBadgeOnCovers,
    setShowFinishedBadgeOnCovers,
    setUseTokenWithCoverImages,
  } = useSettingsActions();

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
      </ScrollView>
    </View>
  );
};

export const SettingsSystemScreen = () => {
  const useTokenWithCoverImages = useSettingsStore((state) => state.useTokenWithCoverImages);
  const showFavoriteBadgeOnCovers = useSettingsStore((state) => state.showFavoriteBadgeOnCovers);
  const showFinishedBadgeOnCovers = useSettingsStore((state) => state.showFinishedBadgeOnCovers);
  const {
    setShowFavoriteBadgeOnCovers,
    setShowFinishedBadgeOnCovers,
    setUseTokenWithCoverImages,
  } = useSettingsActions();
  const [isCoverImagesExpanded, setIsCoverImagesExpanded] = useState(false);
  const [isCoverBadgesExpanded, setIsCoverBadgesExpanded] = useState(false);

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
            <SwiftText>
              Choose how the app requests cover art from Audiobookshelf.
            </SwiftText>
            <Toggle
              isOn={useTokenWithCoverImages}
              onIsOnChange={setUseTokenWithCoverImages}
            >
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
            <SwiftText>
              Show or hide the status badges drawn on top of book covers.
            </SwiftText>
            <Toggle
              isOn={showFavoriteBadgeOnCovers}
              onIsOnChange={setShowFavoriteBadgeOnCovers}
            >
              <SwiftText>Show favorite badge</SwiftText>
              <SwiftText>Display a heart for books marked as favorites.</SwiftText>
            </Toggle>
            <Toggle
              isOn={showFinishedBadgeOnCovers}
              onIsOnChange={setShowFinishedBadgeOnCovers}
            >
              <SwiftText>Show read badge</SwiftText>
              <SwiftText>Display a checkmark for finished books.</SwiftText>
            </Toggle>
          </DisclosureGroup>
        </Section>
      </List>
    </Host>
  );
};
