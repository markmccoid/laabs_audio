import { useAuthStore } from "@/auth/auth-store";
import { usePodcastHomeShelves } from "@/hooks/use-podcast-home-shelves";
import { episodeIdentityKey } from "@/podcast/episode-identity";
import { selectPodcastShelfMembershipOptions } from "@/podcast/podcast-shelf-membership";
import {
  queuePodcastPlaylistOperation,
  replayPendingPodcastPlaylistOperations,
} from "@/podcast/podcast-playlist-sync";
import type { PodcastShelfEpisodeSnapshot } from "@/podcast/podcast-shelf-types";
import { usePodcastShelvesStore } from "@/store/podcast-shelves-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const param = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const EpisodeBookshelvesSheet = () => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    libraryItemId?: string | string[];
    episodeId?: string | string[];
    episodeTitle?: string | string[];
    podcastTitle?: string | string[];
    coverUri?: string | string[];
    durationSeconds?: string | string[];
    publishedAt?: string | string[];
  }>();
  const identity = {
    libraryItemId: param(params.libraryItemId) ?? "",
    episodeId: param(params.episodeId) ?? "",
  };
  const key = episodeIdentityKey(identity);
  const { allShelves, scope } = usePodcastHomeShelves();
  const isOnline = useAuthStore((state) => state.isOnline !== false);
  const actions = usePodcastShelvesStore((state) => state.actions);
  const snapshot: PodcastShelfEpisodeSnapshot = {
    ...identity,
    title: param(params.episodeTitle)?.trim() || "Episode",
    podcastTitle: param(params.podcastTitle)?.trim() || "Podcast",
    cover: param(params.coverUri)?.trim() || null,
    coverFull: param(params.coverUri)?.trim() || null,
    durationSeconds: Math.max(0, Number(param(params.durationSeconds)) || 0),
    publishedAt: Number.isFinite(Number(param(params.publishedAt)))
      ? Number(param(params.publishedAt))
      : null,
  };
  const destinations = selectPodcastShelfMembershipOptions(
    allShelves,
    identity,
  );

  const toggle = (option: (typeof destinations)[number]) => {
    if (!scope || !key) return;
    const { shelf, isMember } = option;
    if (isMember) {
      actions.removeEpisodeFromShelf(shelf.id, identity, scope);
    } else {
      actions.addEpisodeToShelf(shelf.id, snapshot, scope);
    }
    if (shelf.kind === "playlistEpisode") {
      queuePodcastPlaylistOperation(
        {
          type: isMember ? "removeEpisodes" : "addEpisodes",
          shelfId: shelf.id,
          absPlaylistId: shelf.absPlaylistId,
          payload: {
            episodes: [identity],
          },
        },
        scope,
      );
      if (isOnline) void replayPendingPodcastPlaylistOperations(scope);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: Math.max(24, insets.bottom + 12),
        gap: 10,
      }}
    >
      <Stack.Screen options={{ headerTitle: "Add To Bookshelves" }} />
      {destinations.map((option) => {
        const { shelf, isMember } = option;
        return (
          <Pressable
            key={shelf.id}
            disabled={!scope || !key}
            onPress={() => toggle(option)}
            style={({ pressed }) => ({
              borderRadius: 14,
              borderWidth: 1,
              borderColor: isMember ? colors.accent : colors.border,
              backgroundColor: colors.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                {shelf.title}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 3 }}>
                {shelf.kind === "playlistEpisode" ? "Playlist" : "Device-only"}
                {!shelf.isVisible ? " · Hidden from Home" : ""}
                {shelf.kind === "playlistEpisode" && shelf.syncState === "pending"
                  ? " · Pending sync"
                  : ""}
              </Text>
            </View>
            <SymbolView
              name={isMember ? "checkmark.circle.fill" : "circle"}
              tintColor={isMember ? colors.accent : colors.textMuted}
              size={23}
            />
          </Pressable>
        );
      })}
      {destinations.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>
          No Episode Shelves yet.
        </Text>
      ) : null}
      <Pressable
        onPress={() => router.dismissTo("/(tabs)/settings/bookshelves")}
        style={{
          marginTop: 8,
          borderRadius: 12,
          backgroundColor: colors.accent,
          paddingVertical: 11,
          alignItems: "center",
        }}
      >
        <Text style={{ color: colors.accentForeground, fontWeight: "700" }}>
          Open Bookshelf Settings
        </Text>
      </Pressable>
    </ScrollView>
  );
};
