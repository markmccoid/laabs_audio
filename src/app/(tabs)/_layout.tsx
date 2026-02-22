import { useCachedBookSummary } from "@/hooks/abs-data-hooks";
import { playerService, usePlaybackStore } from "@/player";
import { useThemeColors } from "@/theme/use-app-theme";
import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function TabLayout() {
  const router = useRouter();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const currentBook = useCachedBookSummary(currentLibraryItemId ?? undefined);
  const themeColors = useThemeColors();
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const isPlaying = playbackState === "playing";

  const hasLoadedBook = usePlaybackStore((s) => Boolean(s.libraryItemId) && s.queue.length > 0);

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
          <View
            className="flex-row items-center justify-between h-full px-4 gap-2 bg-surface border-hairline border-gray-400 rounded-full"
            // style={{ borderRadius:  }}
          >
            <Link href="/main-player" asChild>
              <Pressable className="flex-row items-center justify-between flex-1 gap-2">
                <Image
                  source={{ uri: currentBook?.coverFull }}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: themeColors.border,
                  }}
                />
                <View className="flex-col items-center flex-1 w-[100]">
                  <Text style={{ fontSize: 12, color: themeColors.text }} numberOfLines={1}>
                    {currentBook?.title}
                  </Text>
                  {/* <Text style={{ fontSize: 12, color: themeColors.textMuted }} numberOfLines={1}>
                    by {currentBook?.duration}
                  </Text> */}
                </View>
              </Pressable>
            </Link>
            {!isPlaying ? (
              <Pressable onPress={handleToggle}>
                <SymbolView name="play.fill" tintColor={themeColors.accent} />
              </Pressable>
            ) : (
              <Pressable onPress={handleToggle}>
                <SymbolView name="pause.fill" tintColor={themeColors.accent} />
              </Pressable>
            )}
            {/* <CustomTabTrigger name="library">
            <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="book.and.wrench" />
          </CustomTabTrigger> */}
          </View>
        </NativeTabs.BottomAccessory>
      )}
    </NativeTabs>
  );
}
