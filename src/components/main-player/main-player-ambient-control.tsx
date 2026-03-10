import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { ambientService } from "@/ambient/ambient-service";
import { usePlaybackStore } from "@/player";
import { selectSelectedAmbientTrack, useAmbientStore } from "@/store/store-ambient";
import { useThemeColors } from "@/theme/use-app-theme";

const MainPlayerAmbientControl = () => {
  const themeColors = useThemeColors();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const selectedTrack = useAmbientStore(selectSelectedAmbientTrack);
  const ambientPlaybackState = useAmbientStore((state) => state.playbackState);

  if (!selectedTrack) {
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
          paddingHorizontal: 14,
          paddingVertical: 9,
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
        <SymbolView name="plus.circle.fill" size={16} tintColor={themeColors.accent} />
        <Text selectable style={{ color: themeColors.text, fontSize: 14, fontWeight: "700" }}>
          Add Ambient Track
        </Text>
      </Pressable>
    );
  }

  const isPlaying = ambientPlaybackState === "playing";

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

          if (ambientPlaybackState === "paused") {
            ambientService.resumeTrack();
            return;
          }

          ambientService.playTrack(selectedTrack.id, currentLibraryItemId);
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
        accessibilityLabel={`Open ambient picker for ${selectedTrack.fileName}`}
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
        <Text selectable numberOfLines={1} style={{ color: themeColors.text, fontSize: 14, fontWeight: "600" }}>
          {selectedTrack.fileName}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ambient track ${selectedTrack.fileName}`}
        onPress={() => ambientService.stopAndClearSelection()}
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
