import { useCachedBookSummary } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import { useDeviceBooksActions } from "@/store/device-books-store";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function TabLayout() {
  const playbackRate = usePlaybackStore((state) => state.rate);
  const libraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const { setBookPlaybackRate } = useDeviceBooksActions();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const currentBook = useCachedBookSummary(currentLibraryItemId ?? undefined);
  const themeColors = useThemeColors();
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const isPlaying = playbackState === "playing";

  const hasLoadedBook = usePlaybackStore((s) => Boolean(s.libraryItemId) && s.queue.length > 0);
  const handleSetRate = async (rate: number) => {
    await playerService.setRate(rate);
    if (libraryItemId) {
      setBookPlaybackRate(libraryItemId, rate);
    }
  };

  const handleToggle = async () => {
    // if (isLoading) return;
    // if (!isBookActive) {
    //   await playerService.loadBook(libraryItemId, { autoPlay: true });
    //   return;
    // }
    await playerService.togglePlayPause();
  };

  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      disableTransparentOnScrollEdge={true}
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
      <NativeTabs.Trigger name="search" role="search" hidden={false}>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {hasLoadedBook && (
        <NativeTabs.BottomAccessory>
          <View className="gap-1 flex-row items-center justify-between h-full px-4 border-hairline border-gray-400 rounded-full bg-transparent">
            <Link href="/main-player" className="flex-1 items-center flex-row  mt-[4]">
              <Link.Trigger>
                <View className="flex-row items-center h-full flex-1 ">
                  <Image
                    source={{ uri: currentBook?.coverFull }}
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
                      {currentBook?.title}
                    </Text>
                    <Text style={{ fontSize: 10, color: themeColors.textMuted }} numberOfLines={1}>
                      by {currentBook?.author}
                    </Text>
                  </View>
                </View>
              </Link.Trigger>
              <Link.Menu>
                <Link.MenuAction icon="book.closed.fill" onPress={() => playerService.stop()}>
                  Close Book
                </Link.MenuAction>

                <Link.Menu title="Speed" icon="hare.fill">
                  <Link.MenuAction onPress={() => handleSetRate(0.75)} isOn={playbackRate === 0.75}>
                    .75x
                  </Link.MenuAction>
                  <Link.MenuAction onPress={() => handleSetRate(1)} isOn={playbackRate === 1}>
                    1x
                  </Link.MenuAction>
                  <Link.MenuAction onPress={() => handleSetRate(1.25)} isOn={playbackRate === 1.25}>
                    1.25x
                  </Link.MenuAction>
                  <Link.MenuAction onPress={() => handleSetRate(1.5)} isOn={playbackRate === 1.5}>
                    1.5x
                  </Link.MenuAction>
                  <Link.MenuAction onPress={() => handleSetRate(1.75)} isOn={playbackRate === 1.75}>
                    1.75x
                  </Link.MenuAction>
                  <Link.MenuAction onPress={() => handleSetRate(2)} isOn={playbackRate === 2}>
                    2x
                  </Link.MenuAction>
                </Link.Menu>
              </Link.Menu>
            </Link>
            {/* Play / Pause Icon */}
            <Pressable
              onPress={handleToggle}
              className="h-full items-center flex-row w-8 justify-center"
              hitSlop={10}
            >
              {!isPlaying ? (
                <SymbolView name="play.fill" tintColor={themeColors.accent} />
              ) : (
                <SymbolView name="pause.fill" tintColor={themeColors.accent} />
              )}
            </Pressable>
          </View>
        </NativeTabs.BottomAccessory>
      )}
    </NativeTabs>
  );
}
