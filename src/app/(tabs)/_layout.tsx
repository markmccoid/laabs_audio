import { MiniPlayerBottomAccessory } from "@/components/main-player/mini-player-bottom-accessory";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { usePlaybackStore, usePlayerDisplayMedia } from "@/player";
import { resolveStoredDownloadCoverUri, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { requestPlaybackToggleForIdentity } from "@/player/request-playback-toggle";
import { showPlaybackError } from "@/player/show-playback-error";
import { NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  const playerDisplayMedia = usePlayerDisplayMedia();
  const miniPlayerLibraryItemId = playerDisplayMedia.displayLibraryItemId;
  const playbackError = usePlaybackStore((state) => state.error);
  const isEpisodePlayback = playerDisplayMedia.isEpisodePlayback;
  const localCoverUri = useDeviceBooksStore((state) =>
    !isEpisodePlayback && miniPlayerLibraryItemId
      ? resolveStoredDownloadCoverUri(state.downloadedBookData[miniPlayerLibraryItemId])
      : null,
  );
  const { data: currentBook } = useGetItemDetails(
    isEpisodePlayback ? undefined : miniPlayerLibraryItemId || undefined,
  );
  const themeColors = useThemeColors();
  const hasLoadedMedia = playerDisplayMedia.hasLoadedMedia;
  const shouldShowMiniPlayer = hasLoadedMedia || playerDisplayMedia.isPlaybackStartAttempt ||
    Boolean(playbackError && miniPlayerLibraryItemId);
  const title = isEpisodePlayback
    ? (playerDisplayMedia.displayTitle ?? "Episode")
    : (currentBook?.title ?? playerDisplayMedia.displayTitle);
  const author = isEpisodePlayback
    ? (playerDisplayMedia.displaySecondaryTitle ?? "Podcast")
    : currentBook?.author;
  const coverUri = isEpisodePlayback ? undefined : currentBook?.coverFull;
  const handleToggle = async () => {
    try {
      await requestPlaybackToggleForIdentity({ libraryItemId: miniPlayerLibraryItemId,
        episodeId: playerDisplayMedia.displayEpisodeId });
    } catch (error) {
      showPlaybackError(error);
    }
  };

  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      backgroundColor={themeColors.surface}
      tintColor={themeColors.accent}
      iconColor={{ default: themeColors.textMuted, selected: themeColors.accent }}
      labelStyle={{
        default: { color: themeColors.textMuted },
        selected: { color: themeColors.accent, fontWeight: "600" },
      }}
    >
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Lists</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="books.vertical.fill" md="library_books" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gear" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {shouldShowMiniPlayer && (
        <NativeTabs.BottomAccessory>
          <MiniPlayerBottomAccessory
            author={author}
            coverUri={coverUri}
            isEpisodePlayback={isEpisodePlayback}
            libraryItemId={miniPlayerLibraryItemId}
            episodeId={playerDisplayMedia.displayEpisodeId}
            localCoverUri={localCoverUri}
            themeColors={themeColors}
            title={title}
            onToggle={handleToggle}
          />
        </NativeTabs.BottomAccessory>
      )}
    </NativeTabs>
  );
}
