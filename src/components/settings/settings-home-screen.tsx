import { useAuthStore } from "@/auth/auth-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

type SettingsRowProps = {
  href:
    | "/(tabs)/settings/ambient-audio"
    | "/(tabs)/settings/authentication"
    | "/(tabs)/settings/bookshelves"
    | "/(tabs)/settings/playback"
    | "/(tabs)/settings/system"
    | "/(tabs)/settings/testRoute";
  title: string;
  subtitle: string;
  icon: string;
  isLast?: boolean;
};

const SettingsRow = ({ href, title, subtitle, icon, isLast = false }: SettingsRowProps) => {
  const themeColors = useThemeColors();

  return (
    <Link href={href} asChild>
      <Pressable
        style={{
          minHeight: 58,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: isLast ? 0 : 1,
          borderBottomColor: themeColors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            borderCurve: "continuous",
            backgroundColor: themeColors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SymbolView name={icon} tintColor={themeColors.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "500" }}>
            {title}
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {subtitle}
          </Text>
        </View>
        <SymbolView name="chevron.right" tintColor={themeColors.textMuted} />
      </Pressable>
    </Link>
  );
};

const SettingsGroup = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const themeColors = useThemeColors();

  return (
    <View style={{ gap: 8 }}>
      <Text
        selectable
        style={{
          color: themeColors.textMuted,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          paddingHorizontal: 6,
        }}
      >
        {title}
      </Text>
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
        {children}
      </View>
    </View>
  );
};

export const SettingsHomeScreen = () => {
  const themeColors = useThemeColors();
  const status = useAuthStore((state) => state.status);
  const isAuthenticated = status === "authenticated";

  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 28,
          gap: 20,
        }}
      >
        <Text
          selectable
          style={{ color: themeColors.textMuted, fontSize: 13, paddingHorizontal: 4 }}
        >
          Configure account access and how bookshelves appear on Home.
        </Text>

        <SettingsGroup title="Account">
          <SettingsRow
            href="/(tabs)/settings/authentication"
            title="Authentication"
            subtitle="Manage server, account, and session state"
            icon="person.crop.circle"
            isLast
          />
        </SettingsGroup>

        {isAuthenticated ? (
          <SettingsGroup title="Library">
            <SettingsRow
              href="/(tabs)/settings/bookshelves"
              title="Bookshelves"
              subtitle="Visibility, order, names, and home item counts"
              icon="books.vertical"
            />
            <SettingsRow
              href="/(tabs)/settings/playback"
              title="Playback"
              subtitle="Defaults for progress display and player behavior"
              icon="play.circle"
            />
            <SettingsRow
              href="/(tabs)/settings/ambient-audio"
              title="Ambient Audio"
              subtitle="Import and manage looped ambient tracks"
              icon="speaker.wave.2"
            />
            <SettingsRow
              href="/(tabs)/settings/system"
              title="System"
              subtitle="App-level behavior for images and cover handling"
              icon="gearshape.2"
            />
            {/* <SettingsRow
              href="/(tabs)/settings/testRoute"
              title="Testng"
              subtitle="Testomg"
              icon="gearshape.2"
              isLast
            /> */}
          </SettingsGroup>
        ) : null}
      </ScrollView>
    </View>
  );
};
