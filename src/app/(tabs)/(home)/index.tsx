import { useAuthStore } from "@/auth/auth-store";
import { playerService, usePlaybackStore } from "@/player";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const LOCAL_BOOK_ID = "local-demo-book";
const LOCAL_M4B = require("../../../../assets/TestFile.m4b");
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
        >
          <View className="w-full max-w-md self-center flex-row items-center justify-between">
            <View>
              <Text className="text-sm font-semibold text-slate-900">Home Player</Text>
              <Text className="text-xs text-slate-500">
                {loadError ? "Error" : isPlaying ? "Playing" : "Paused"}
              </Text>
            </View>
            <Pressable
              className={`rounded-full px-4 py-2 ${isLoading ? "bg-slate-200" : "bg-amber-600"}`}
              onPress={handleToggle}
              disabled={isLoading || !!loadError}
            >
              {isLoading ? (
                <ActivityIndicator color="#111827" />
              ) : (
                <Text className="text-sm font-semibold text-white">
                  {isPlaying ? "Pause" : "Play"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
        <View className="items-center gap-6 px-6 pt-6">
          <View className="p-4 bg-white rounded-3xl border-hairline border-amber-600">
            <Text className="text-base">
              User {auth.storedUsername} is {auth.status} for {auth.serverUrl}
            </Text>
          </View>
          <View className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <Text className="text-lg font-semibold">Home Player</Text>
            <Text className="text-sm text-slate-500 mt-1">
              Oh, the Places You'll Go! • Dr. Seuss
            </Text>
            <View className="mt-4 flex-row items-center justify-between">
              <Text className="text-sm text-slate-600">
                {positionSeconds}s / {durationSeconds || "--"}s
              </Text>
              <Text className="text-sm text-slate-600 capitalize">
                {loadError ? "error" : playbackState}
              </Text>
            </View>
            {loadError ? (
              <Text className="mt-3 text-sm text-red-600">{loadError}</Text>
            ) : (
              <Pressable
                className={`mt-4 items-center rounded-full px-6 py-3 ${
                  isLoading ? "bg-slate-200" : "bg-amber-600"
                }`}
                onPress={handleToggle}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#111827" />
                ) : (
                  <Text className="text-base font-semibold text-white">
                    {isPlaying ? "Pause" : "Play"}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
          <View className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <Text className="text-lg font-semibold">Debug Panel</Text>
            <Text className="mt-1 text-xs text-slate-500">
              Asset module: {typeof LOCAL_M4B === "number" ? LOCAL_M4B : "invalid"}
            </Text>
            <View className="mt-3 gap-2">
              <Text className="text-sm text-slate-700">Ready: {String(isReady)}</Text>
              <Text className="text-sm text-slate-700">Load error: {loadError ?? "--"}</Text>
              <Text className="text-sm text-slate-700">Playback state: {playbackState}</Text>
              <Text className="text-sm text-slate-700">
                Playback error: {playbackError ?? "--"}
              </Text>
              <Text className="text-sm text-slate-700">Rate: {rate}</Text>
              <Text className="text-sm text-slate-700">Book ID: {currentBookId ?? "--"}</Text>
              <Text className="text-sm text-slate-700">
                Position: {positionSeconds}s / {durationSeconds || "--"}s
              </Text>
              <Text className="text-sm text-slate-700">
                Track {currentTrackIndex + 1}: {trackPositionSeconds}s /{" "}
                {trackDurationSeconds || "--"}s
              </Text>
              <Text className="text-sm text-slate-700">Chapter ID: {currentChapterId ?? "--"}</Text>
              <Text className="text-sm text-slate-700">Last sync: {lastSyncLabel}</Text>
              <Text className="text-sm text-slate-700">Debug message: {debugMessage ?? "--"}</Text>
              <Text className="text-sm text-slate-700">
                Engine status:{" "}
                {debugStatus ? `${debugStatus.positionMs}ms / ${debugStatus.durationMs}ms` : "--"}
              </Text>
              <Text className="text-sm text-slate-700">
                Engine playing: {debugStatus ? String(debugStatus.isPlaying) : "--"} • finished:{" "}
                {debugStatus ? String(debugStatus.didJustFinish) : "--"}
              </Text>
              <Text className="text-sm text-slate-700">Engine updated: {debugUpdatedLabel}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
