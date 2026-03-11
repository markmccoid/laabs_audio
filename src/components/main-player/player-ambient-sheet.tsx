import { ambientService } from "@/ambient/ambient-service";
import { usePlaybackStore } from "@/player";
import { selectSelectedAmbientTrack, useAmbientStore } from "@/store/store-ambient";
import { useThemeColors } from "@/theme/use-app-theme";
import Slider from "@react-native-community/slider";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

const formatVolumeLabel = (volume: number) => `${Math.round(volume * 100)}%`;

const PlayerAmbientSheet = () => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const isEnabled = useAmbientStore((state) => state.isEnabled);
  const trackOrder = useAmbientStore((state) => state.trackOrder);
  const tracksById = useAmbientStore((state) => state.tracksById);
  const selectedTrack = useAmbientStore(selectSelectedAmbientTrack);
  const ambientTracks = useMemo(
    () => trackOrder.map((trackId) => tracksById[trackId]).filter(Boolean),
    [trackOrder, tracksById],
  );
  const sliderWidth = Math.max(220, width - 96);
  const helperText = useMemo(() => {
    if (ambientTracks.length > 0) return "Choose a track to start looped ambient playback.";
    return "Import tracks from Settings > Ambient Audio before using ambient playback here.";
  }, [ambientTracks.length]);

  return (
    <View
      collapsable={false}
      style={{
        flex: 1,
        backgroundColor: themeColors.bg,
        paddingHorizontal: 20,
        paddingTop: 22,
        paddingBottom: 18,
        gap: 16,
      }}
    >
      <View style={{ gap: 6 }}>
        <Text selectable style={{ fontSize: 24, fontWeight: "700", color: themeColors.text }}>
          Ambient Audio
        </Text>
        <Text selectable style={{ fontSize: 13, color: themeColors.textMuted }}>
          {isEnabled
            ? helperText
            : "Ambient audio is disabled. Enable it in Settings > Ambient Audio to use it in the player."}
        </Text>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
      >
        {isEnabled ? (
          <View
            style={{
              borderRadius: 18,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              borderWidth: 1,
              borderColor: themeColors.border,
              overflow: "hidden",
            }}
          >
            {ambientTracks.length ? (
              ambientTracks.map((track, index) => {
                const isSelected = selectedTrack?.id === track.id;
                return (
                  <Pressable
                    key={track.id}
                    onPress={() => {
                      ambientService.playTrack(track.id, currentLibraryItemId);
                      router.back();
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderBottomWidth: index === ambientTracks.length - 1 ? 0 : 1,
                      borderBottomColor: themeColors.border,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      backgroundColor: isSelected ? themeColors.bg : themeColors.surface,
                      opacity: pressed ? 0.82 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        borderCurve: "continuous",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: isSelected ? themeColors.accent : themeColors.bg,
                      }}
                    >
                      <SymbolView
                        name={isSelected ? "speaker.wave.2.fill" : "waveform"}
                        size={18}
                        tintColor={isSelected ? themeColors.accentForeground : themeColors.accent}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        selectable
                        numberOfLines={1}
                        style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                      >
                        {track.fileName}
                      </Text>
                      <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                        Default volume {formatVolumeLabel(track.volume)}
                      </Text>
                    </View>
                    {isSelected ? (
                      <SymbolView
                        name="checkmark.circle.fill"
                        size={20}
                        tintColor={themeColors.accent}
                      />
                    ) : null}
                  </Pressable>
                );
              })
            ) : (
              <View style={{ paddingHorizontal: 16, paddingVertical: 18, gap: 6 }}>
                <Text selectable style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}>
                  No ambient tracks available
                </Text>
                <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  Open Settings and import ambient audio from your device or iCloud Files.
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {isEnabled && selectedTrack ? (
          <View
            style={{
              borderRadius: 18,
              borderCurve: "continuous",
              backgroundColor: themeColors.surface,
              borderWidth: 1,
              borderColor: themeColors.border,
              paddingHorizontal: 14,
              paddingVertical: 14,
              gap: 12,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
                Ambient Volume
              </Text>
              <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                {selectedTrack.fileName} · {formatVolumeLabel(selectedTrack.volume)}
              </Text>
            </View>
            <Slider
              style={{ width: sliderWidth, alignSelf: "center" }}
              minimumTrackTintColor={themeColors.accent}
              maximumTrackTintColor={themeColors.border}
              thumbTintColor={themeColors.accent}
              minimumValue={0}
              maximumValue={1}
              step={0.05}
              value={selectedTrack.volume}
              onValueChange={(value) => ambientService.setTrackVolume(selectedTrack.id, value)}
            />
          </View>
        ) : null}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close ambient sheet"
        onPress={() => router.back()}
        style={({ pressed }) => ({
          borderRadius: 999,
          borderCurve: "continuous",
          paddingVertical: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.accent,
          opacity: pressed ? 0.82 : 1,
        })}
      >
        <Text
          selectable
          style={{ color: themeColors.accentForeground, fontWeight: "700", fontSize: 15 }}
        >
          Close
        </Text>
      </Pressable>
    </View>
  );
};

export default PlayerAmbientSheet;
