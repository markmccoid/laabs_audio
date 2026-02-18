import { playerService, usePlaybackStore } from "@/player";
import { useCurrentPlaybackBookDetails } from "@/store/store-books";
import { Image } from "expo-image";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function TabLayout() {
  const currentBook = useCurrentPlaybackBookDetails();
  const [showMini, setShowMini] = useState(false);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const isPlaying = playbackState === "playing";
  const currentBookId = usePlaybackStore((state) => state.bookId);

  const hasLoadedBook = usePlaybackStore((s) => Boolean(s.bookId) && s.queue.length > 0);

  const testMini = () => {
    setShowMini(false);
    setTimeout(() => setShowMini(true), 2000);
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
    <NativeTabs minimizeBehavior="onScrollDown" disableTransparentOnScrollEdge={true}>
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
          <View className="flex-row items-center justify-between h-full px-4 gap-2">
            <Image
              source={{ uri: currentBook?.coverFull }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                borderWidth: StyleSheet.hairlineWidth,
              }}
            />
            <View className="flex-col items-center flex-1 w-[100]">
              <Text style={{ fontSize: 12 }} numberOfLines={1}>
                {currentBook?.title}
              </Text>
              <Text className="" style={{ fontSize: 12 }}>
                by {currentBook?.author}
              </Text>
            </View>
            {!isPlaying ? (
              <Pressable onPress={handleToggle}>
                <SymbolView name="play.fill" tintColor="black" />
              </Pressable>
            ) : (
              <Pressable onPress={handleToggle}>
                <SymbolView name="pause.fill" tintColor="black" />
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
