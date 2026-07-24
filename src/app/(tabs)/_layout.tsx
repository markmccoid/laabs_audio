import { MiniPlayerBottomAccessory } from "@/components/main-player/mini-player-bottom-accessory";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore, usePlayerDisplayAudiobook } from "@/player";
import { resolveStoredDownloadCoverUri, useDeviceBooksStore } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playbackControlIntent = usePlaybackStore((state) => state.playbackControlIntent);
  const playerDisplayAudiobook = usePlayerDisplayAudiobook();
  const miniPlayerLibraryItemId = playerDisplayAudiobook.displayLibraryItemId;
  const isMiniPlayerLoading = playerDisplayAudiobook.isPlaybackStartAttempt;
  const isEpisodePlayback = playerDisplayAudiobook.isEpisodePlayback;
  const localCoverUri = useDeviceBooksStore((state) =>
    !isEpisodePlayback && miniPlayerLibraryItemId
      ? resolveStoredDownloadCoverUri(state.downloadedBookData[miniPlayerLibraryItemId])
      : null,
  );
  const { data: currentBook } = useGetItemDetails(
    isEpisodePlayback ? undefined : miniPlayerLibraryItemId || undefined,
  );
  const themeColors = useThemeColors();
  const isPlaying = playbackState === "playing";
  const hasLoadedBook = playerDisplayAudiobook.hasLoadedBook;
  const shouldShowMiniPlayer = hasLoadedBook || playerDisplayAudiobook.isPlaybackStartAttempt;
  const title = isEpisodePlayback
    ? (playerDisplayAudiobook.displayTitle ?? "Episode")
    : currentBook?.title;
  const author = isEpisodePlayback
    ? (playerDisplayAudiobook.displaySecondaryTitle ?? "Podcast")
    : currentBook?.author;
  const coverUri = isEpisodePlayback ? undefined : currentBook?.coverFull;
  const handleToggle = async () => {
    if (playbackControlIntent) return;
    if (isPlaying) {
      await playerService.requestPause();
    } else {
      await playerService.requestPlay();
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
            isLoading={isMiniPlayerLoading}
            isPlaying={isPlaying}
            libraryItemId={miniPlayerLibraryItemId}
            localCoverUri={localCoverUri}
            playbackControlIntent={playbackControlIntent}
            themeColors={themeColors}
            title={title}
            onToggle={handleToggle}
          />
        </NativeTabs.BottomAccessory>
      )}
    </NativeTabs>
  );
}
