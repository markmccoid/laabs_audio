import { EpisodeDownloadControls } from "@/components/podcast/episode-download-controls";
import { useThemeColors } from "@/theme/use-app-theme";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const EpisodeDownloadsSheet = () => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    episodeId?: string | string[];
    episodeTitle?: string | string[];
    podcastTitle?: string | string[];
    coverUri?: string | string[];
  }>();

  const libraryItemId = resolveParam(params.libraryItemId)?.trim() ?? "";
  const episodeId = resolveParam(params.episodeId)?.trim() ?? "";
  const episodeTitle = resolveParam(params.episodeTitle)?.trim() || null;
  const podcastTitle = resolveParam(params.podcastTitle)?.trim() || null;
  const coverUri = resolveParam(params.coverUri)?.trim() || null;

  return (
    <ScrollView
      style={{ flex: 1 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={{
        backgroundColor: themeColors.bg,
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingTop: 35,
        paddingBottom: Math.max(24, insets.bottom + 12),
        gap: 12,
      }}
    >
      <Stack.Screen options={{ title: "Download" }} />
      <View
        style={{
          borderRadius: 16,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: themeColors.border,
          backgroundColor: themeColors.surface,
          padding: 14,
          gap: 8,
        }}
      >
        <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
          Download info
        </Text>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          {episodeTitle || "Episode"}
        </Text>
        {podcastTitle ? (
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {podcastTitle}
          </Text>
        ) : null}
      </View>

      {libraryItemId && episodeId ? (
        <EpisodeDownloadControls
          libraryItemId={libraryItemId}
          episodeId={episodeId}
          episodeTitle={episodeTitle}
          podcastTitle={podcastTitle}
          coverUri={coverUri}
          context="sheet"
        />
      ) : (
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          Episode not found.
        </Text>
      )}
    </ScrollView>
  );
};
