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
  const localCoverUri = useDeviceBooksStore((state) =>
    miniPlayerLibraryItemId
      ? resolveStoredDownloadCoverUri(state.downloadedBookData[miniPlayerLibraryItemId])
      : null,
  );
  const { data: currentBook } = useGetItemDetails(miniPlayerLibraryItemId || undefined);
  const themeColors = useThemeColors();
  const isPlaying = playbackState === "playing";
  const hasLoadedBook = playerDisplayAudiobook.hasLoadedBook;
  const shouldShowMiniPlayer = hasLoadedBook || playerDisplayAudiobook.isPlaybackStartAttempt;
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
      // disableTransparentOnScrollEdge={true}
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
      {/* <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Icon sf="book.fill" md="settings" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger> */}
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
            author={currentBook?.author}
            coverUri={currentBook?.coverFull}
            isLoading={isMiniPlayerLoading}
            isPlaying={isPlaying}
            libraryItemId={miniPlayerLibraryItemId}
            localCoverUri={localCoverUri}
            playbackControlIntent={playbackControlIntent}
            themeColors={themeColors}
            title={currentBook?.title}
            onToggle={handleToggle}
          />
        </NativeTabs.BottomAccessory>
      )}
    </NativeTabs>
  );
}
