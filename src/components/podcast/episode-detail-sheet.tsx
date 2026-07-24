import { EpisodeDownloadControls } from "@/components/podcast/episode-download-controls";
import { playerService } from "@/player";
import { COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/text-scaling";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const resolveParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const EpisodeDetailSheet = () => {
  const themeColors = useThemeColors();
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    episodeId?: string | string[];
    episodeTitle?: string | string[];
    podcastTitle?: string | string[];
    coverUri?: string | string[];
    description?: string | string[];
    publishedAt?: string | string[];
    durationSeconds?: string | string[];
  }>();

  const libraryItemId = resolveParam(params.libraryItemId)?.trim() ?? "";
  const episodeId = resolveParam(params.episodeId)?.trim() ?? "";
  const episodeTitle = resolveParam(params.episodeTitle)?.trim() || "Episode";
  const podcastTitle = resolveParam(params.podcastTitle)?.trim() || "Podcast";
  const coverUri = resolveParam(params.coverUri)?.trim() || null;
  const description = resolveParam(params.description)?.trim() || null;
  const publishedAtRaw = resolveParam(params.publishedAt);
  const durationRaw = resolveParam(params.durationSeconds);
  const publishedAt =
    publishedAtRaw && Number.isFinite(Number(publishedAtRaw))
      ? new Date(Number(publishedAtRaw)).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;
  const durationSeconds =
    durationRaw && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : null;
  const durationLabel =
    durationSeconds != null && durationSeconds > 0
      ? (() => {
          const seconds = Math.floor(durationSeconds);
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor((seconds % 3600) / 60);
          if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
          return `${minutes}m`;
        })()
      : null;

  if (!libraryItemId || !episodeId) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.surface }]}>
        <Text style={{ color: themeColors.textMuted }}>Episode not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: themeColors.surface }}
      contentContainerStyle={styles.content}
    >
      <Text
        maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        selectable
        style={[styles.title, { color: themeColors.text }]}
      >
        {episodeTitle}
      </Text>
      <Text
        maxFontSizeMultiplier={COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        selectable
        style={{ color: themeColors.textMuted, fontSize: 15, marginTop: 4 }}
      >
        {podcastTitle}
      </Text>
      {publishedAt || durationLabel ? (
        <Text style={{ color: themeColors.textMuted, fontSize: 13, marginTop: 8 }}>
          {[publishedAt, durationLabel].filter(Boolean).join(" · ")}
        </Text>
      ) : null}

      {description ? (
        <Text
          selectable
          style={{ color: themeColors.text, fontSize: 14, lineHeight: 20, marginTop: 14 }}
        >
          {description}
        </Text>
      ) : null}

      <View style={{ marginTop: 18, gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Play ${episodeTitle}`}
          onPress={() => {
            void playerService.requestStartEpisode(libraryItemId, episodeId, {
              episodeTitle,
              podcastTitle,
            });
            router.back();
          }}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: themeColors.accent,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Play Episode</Text>
        </Pressable>

        <EpisodeDownloadControls
          libraryItemId={libraryItemId}
          episodeId={episodeId}
          episodeTitle={episodeTitle}
          podcastTitle={podcastTitle}
          coverUri={coverUri}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
});
