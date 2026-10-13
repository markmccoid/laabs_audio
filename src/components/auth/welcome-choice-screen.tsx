import { useAuthActions, useAuthStore } from "@/auth/auth-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

type ChoiceCardProps = {
  icon: ComponentProps<typeof SymbolView>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
};

const ChoiceCard = ({ icon, title, subtitle, onPress }: ChoiceCardProps) => {
  const themeColors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 16,
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.bg,
        }}
      >
        <SymbolView name={icon} tintColor={themeColors.accent} size={24} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: themeColors.text, fontSize: 17, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>{subtitle}</Text>
      </View>
      <SymbolView name="chevron.right" tintColor={themeColors.textMuted} />
    </Pressable>
  );
};

/**
 * The Welcome Choice (CONTEXT.md): shown in Signed-Out Required Sign-In with two equal paths —
 * User Session Entry for an Audiobookshelf Server, or Imported-Only Mode.
 */
export const WelcomeChoiceScreen = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const rememberedSessionCount = useAuthStore((state) => state.rememberedSessions.length);
  const { chooseImportedOnly } = useAuthActions();
  const params = useLocalSearchParams<{ returnToLibraryItemId?: string | string[] }>();
  const returnToLibraryItemId = resolveParam(params.returnToLibraryItemId);

  const connect = () => {
    router.push({
      pathname: rememberedSessionCount > 0 ? "/login" : "/login/add",
      params: {
        mode: "required",
        ...(returnToLibraryItemId ? { returnToLibraryItemId } : {}),
      },
    } as never);
  };

  const useOwnFiles = () => {
    chooseImportedOnly();
    router.replace("/(tabs)/(home)");
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: themeColors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 28,
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 8, alignItems: "center" }}>
        <SymbolView name="headphones" tintColor={themeColors.accent} size={48} />
        <Text
          style={{ color: themeColors.text, fontSize: 28, fontWeight: "700", textAlign: "center" }}
        >
          Welcome to LAABS Audio
        </Text>
        <Text style={{ color: themeColors.textMuted, fontSize: 16, textAlign: "center" }}>
          How do you want to listen?
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <ChoiceCard
          icon="server.rack"
          title="Connect to Audiobookshelf"
          subtitle="Sign in to your Audiobookshelf server to stream and download your library."
          onPress={connect}
        />
        <ChoiceCard
          icon="folder"
          title="Use my own audio files"
          subtitle="Import audiobooks from Files or iCloud Drive. You can connect a server later in Settings."
          onPress={useOwnFiles}
        />
      </View>
    </ScrollView>
  );
};
