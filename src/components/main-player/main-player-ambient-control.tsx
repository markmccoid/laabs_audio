import { ambientService } from "@/ambient/ambient-service";
import { usePlaybackStore } from "@/player";
import {
  selectActiveAmbientTrack,
  selectAttachedAmbientTrackForBook,
  selectAvailableAmbientTracks,
  useAmbientStore,
} from "@/store/store-ambient";
import { useThemeColors } from "@/theme/use-app-theme";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";

const MainPlayerAmbientControl = () => {
  const themeColors = useThemeColors();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const hasLoadedBook = usePlaybackStore(
    (state) => Boolean(state.libraryItemId) && state.queue.length > 0,
  );
  const isEnabled = useAmbientStore((state) => state.isEnabled);
  const availableTrackCount = useAmbientStore((state) => selectAvailableAmbientTracks(state).length);
  const attachedTrack = useAmbientStore((state) =>
    selectAttachedAmbientTrackForBook(state, currentLibraryItemId),
  );
  const activeTrack = useAmbientStore(selectActiveAmbientTrack);
  const activeLibraryItemId = useAmbientStore((state) => state.activeLibraryItemId);
  const ambientPlaybackState = useAmbientStore((state) => state.playbackState);

  if (!hasLoadedBook || !isEnabled || availableTrackCount === 0) {
    return null;
  }

  if (!attachedTrack) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add ambient track"
        onPress={() => router.push("/player-ambient")}
        style={({ pressed }) => ({
          marginTop: 8,
          minHeight: 40,
          borderRadius: 999,
          borderCurve: "continuous",
          paddingHorizontal: 12,
          paddingVertical: 6,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: themeColors.accent,
          backgroundColor: themeColors.surface,
          opacity: pressed ? 0.82 : 1,
        })}
      >
        <SymbolView name="speaker.wave.2.fill" size={25} tintColor={themeColors.accent} />
        <Text selectable style={{ color: themeColors.text, fontSize: 12, fontWeight: "700" }}>
          Add Ambient
        </Text>
      </Pressable>
    );
  }

  const isActiveForCurrentBook =
    activeTrack?.id === attachedTrack.id && activeLibraryItemId === currentLibraryItemId;
  const isPlaying = isActiveForCurrentBook && ambientPlaybackState === "playing";
  const isPaused = isActiveForCurrentBook && ambientPlaybackState === "paused";

  return (
    <View
      style={{
        marginTop: 8,
        minHeight: 46,
        borderRadius: 14,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: themeColors.border,
        backgroundColor: themeColors.surface,
        paddingHorizontal: 8,
        paddingVertical: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "Pause ambient track" : "Play ambient track"}
        onPress={() => {
          if (isPlaying) {
            ambientService.pauseTrack();
            return;
          }

          if (isPaused) {
            ambientService.resumeTrack();
            return;
          }

          ambientService.loadAttachedTrackForBook(currentLibraryItemId);
        }}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.accent,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <SymbolView
          name={isPlaying ? "pause.fill" : "play.fill"}
          size={16}
          tintColor={themeColors.accentForeground}
        />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ambient picker for ${attachedTrack.fileName}`}
        onPress={() => router.push("/player-ambient")}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 34,
          borderRadius: 10,
          borderCurve: "continuous",
          justifyContent: "center",
          paddingHorizontal: 6,
          opacity: pressed ? 0.78 : 1,
        })}
      >
        <Text
          selectable
          numberOfLines={1}
          style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}
        >
          {attachedTrack.fileName}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ambient track ${attachedTrack.fileName}`}
        onPress={() => ambientService.detachTrackFromBook(currentLibraryItemId)}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.bg,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <SymbolView name="xmark" size={15} tintColor={themeColors.textMuted} />
      </Pressable>
    </View>
  );
};

export default MainPlayerAmbientControl;
