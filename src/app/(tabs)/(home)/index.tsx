import { useAuthStore } from "@/auth/auth-store";
import { playerService, usePlaybackStore } from "@/player";
import { Link } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LOCAL_BOOK_ID = "local-demo-book";

// const LOCAL_M4B = require("../../../assets/ambient.mp3");

export default function Index() {
  const { top: topInset } = useSafeAreaInsets();
  const auth = useAuthStore((state) => state);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const durationMs = usePlaybackStore((state) => state.durationMs);
  const trackPositionMs = usePlaybackStore((state) => state.trackPositionMs);
  const trackDurationMs = usePlaybackStore((state) => state.trackDurationMs);
  const currentTrackIndex = usePlaybackStore((state) => state.currentTrackIndex);
  const currentChapterId = usePlaybackStore((state) => state.currentChapterId);
  const rate = usePlaybackStore((state) => state.rate);
  const lastSyncAt = usePlaybackStore((state) => state.lastSyncAt);
  const playbackError = usePlaybackStore((state) => state.error);
  const debugStatus = usePlaybackStore((state) => state.debugStatus);
  const debugMessage = usePlaybackStore((state) => state.debugMessage);
  const currentBookId = usePlaybackStore((state) => state.bookId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isPlaying = playbackState === "playing";
  const isLoading = playbackState === "loading" || !isReady;
  const positionSeconds = Math.floor(positionMs / 1000);
  const durationSeconds = Math.floor(durationMs / 1000);
  const trackPositionSeconds = Math.floor(trackPositionMs / 1000);
  const trackDurationSeconds = Math.floor(trackDurationMs / 1000);
  const lastSyncLabel = lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : "--";
  const debugUpdatedLabel = debugStatus?.updatedAt
    ? new Date(debugStatus.updatedAt).toLocaleTimeString()
    : "--";

  const handleToggle = async () => {
    if (isLoading || loadError) return;
    if (isPlaying) {
      await playerService.pause();
    } else {
      await playerService.play();
    }
  };
  return (
    <View style={{ flex: 1, paddingTop: topInset }}>
      <Link href="/:555">
        <Text>GO TO 555</Text>
      </Link>
      <ScrollView
        className="flex-1 bg-slate-50"
        // style={{ marginTop: topInset }}
        // contentInset={{ top: topInset }}
        // contentOffset={{ x: 0, y: topInset }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
      >
        <View
          className=" border-slate-200 bg-white px-6 py-3 border"
          // style={{ paddingTop: topInset }}
        ></View>
      </ScrollView>
    </View>
  );
}
