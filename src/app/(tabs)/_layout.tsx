import { CoverImage } from "@/components/images/cover-image";
import { useGetItemDetails } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore, usePlayerDisplayAudiobook } from "@/player";
import type { PlaybackControlIntent } from "@/player/playback-store";
import {
  resolveStoredDownloadCoverUri,
  useDeviceBooksActions,
  useDeviceBooksStore,
} from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Link } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export default function TabLayout() {
  const playbackRate = usePlaybackStore((state) => state.rate);
  const libraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const { setBookPlaybackRate } = useDeviceBooksActions();
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
  const handleSetRate = async (rate: number) => {
    await playerService.setRate(rate);
    if (libraryItemId) {
      setBookPlaybackRate(libraryItemId, rate);
    }
  };
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
            hasLoadedBook={hasLoadedBook}
            isLoading={isMiniPlayerLoading}
            isPlaying={isPlaying}
            libraryItemId={miniPlayerLibraryItemId}
            localCoverUri={localCoverUri}
            playbackControlIntent={playbackControlIntent}
            playbackRate={playbackRate}
            themeColors={themeColors}
            title={currentBook?.title}
            onSetRate={handleSetRate}
            onToggle={handleToggle}
          />
        </NativeTabs.BottomAccessory>
      )}
    </NativeTabs>
  );
}

type MiniPlayerBottomAccessoryProps = {
  author?: string | null;
  coverUri?: string | null;
  hasLoadedBook: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  libraryItemId?: string | null;
  localCoverUri?: string | null;
  playbackControlIntent?: PlaybackControlIntent | null;
  playbackRate: number;
  themeColors: ReturnType<typeof useThemeColors>;
  title?: string | null;
  onSetRate: (rate: number) => Promise<void>;
  onToggle: () => Promise<void>;
};

function MiniPlayerBottomAccessory({
  author,
  coverUri,
  hasLoadedBook,
  isLoading,
  isPlaying,
  libraryItemId,
  localCoverUri,
  playbackControlIntent,
  playbackRate,
  themeColors,
  title,
  onSetRate,
  onToggle,
}: MiniPlayerBottomAccessoryProps) {
  const isInline = NativeTabs.BottomAccessory.usePlacement();
  console.log("INLINE", isInline);
  return (
    <View className="gap-1 flex-1 flex-row items-center h-full justify-between px-4 border-hairline border-gray-400 rounded-full bg-transparent">
      <Link href="/main-player" className="flex-1 items-center flex-row  mt-[4]">
        <Link.Trigger>
          <View className="flex-row items-center h-full flex-1 ">
            <CoverImage
              libraryItemId={libraryItemId ?? undefined}
              coverUri={coverUri}
              localCoverUri={localCoverUri}
              variant="thumb"
              style={{
                width: 35,
                height: 35,
                marginRight: 8,
                borderRadius: 8,

                borderWidth: StyleSheet.hairlineWidth,
                borderColor: themeColors.border,
              }}
            />

            <View className="flex-col justify-center flex-1 items-start h-full">
              <Text style={{ fontSize: 12, color: themeColors.text }} numberOfLines={1}>
                {title ?? "Starting audiobook"}
              </Text>
              <Text style={{ fontSize: 10, color: themeColors.textMuted }} numberOfLines={1}>
                {isLoading ? "Starting playback..." : `by ${author ?? ""}`}
              </Text>
            </View>
          </View>
        </Link.Trigger>
        {hasLoadedBook && !playbackControlIntent ? (
          <Link.Menu>
            <Link.MenuAction icon="book.closed.fill" onPress={() => playerService.stop()}>
              Close Book
            </Link.MenuAction>

            <Link.Menu title="Speed" icon="hare.fill">
              <Link.MenuAction onPress={() => onSetRate(0.75)} isOn={playbackRate === 0.75}>
                .75x
              </Link.MenuAction>
              <Link.MenuAction onPress={() => onSetRate(1)} isOn={playbackRate === 1}>
                1x
              </Link.MenuAction>
              <Link.MenuAction onPress={() => onSetRate(1.25)} isOn={playbackRate === 1.25}>
                1.25x
              </Link.MenuAction>
              <Link.MenuAction onPress={() => onSetRate(1.5)} isOn={playbackRate === 1.5}>
                1.5x
              </Link.MenuAction>
              <Link.MenuAction onPress={() => onSetRate(1.75)} isOn={playbackRate === 1.75}>
                1.75x
              </Link.MenuAction>
              <Link.MenuAction onPress={() => onSetRate(2)} isOn={playbackRate === 2}>
                2x
              </Link.MenuAction>
            </Link.Menu>
          </Link.Menu>
        ) : null}
      </Link>
      {/* Play / Pause Icon */}
      <Pressable
        onPress={onToggle}
        disabled={Boolean(playbackControlIntent)}
        className="h-full items-center flex-row w-8 justify-center"
        hitSlop={10}
        style={{ opacity: playbackControlIntent ? 0.45 : 1 }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={themeColors.accent} />
        ) : !isPlaying ? (
          <SymbolView name="play.fill" tintColor={themeColors.accent} />
        ) : (
          <SymbolView name="pause.fill" tintColor={themeColors.accent} />
        )}
      </Pressable>
    </View>
  );
}
