import { ambientService } from "@/ambient/ambient-service";
import SliderWithBubble from "@/components/sliders/slider-with-bubble";
import { usePlaybackStore } from "@/player";
import {
  isAmbientTrackAvailable,
  type AmbientTrackRecord,
  selectAmbientPlaybackPreferenceForBook,
  selectAttachedAmbientTrackForBook,
  useAmbientStore,
} from "@/store/store-ambient";
import { useThemeColors } from "@/theme/use-app-theme";
import { formatSeconds } from "@/utils/formatUtils";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";

const formatVolumeLabel = (volume: number) => `${Math.round(volume * 100)}%`;
const formatPositionLabel = (positionMs: number) =>
  formatSeconds(Math.max(0, Math.floor(positionMs / 1000)), "compact", true, true) ?? "00:00";

const sortSelectedAmbientTrackFirst = (
  tracks: AmbientTrackRecord[],
  selectedTrackId?: string | null,
) => {
  if (!selectedTrackId) return tracks;

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  if (!selectedTrack) return tracks;

  return [selectedTrack, ...tracks.filter((track) => track.id !== selectedTrackId)];
};

type AmbientVolumeControlProps = {
  fineVolume: boolean;
  initialVolume: number;
  libraryItemId: string | null;
  sliderWidth: number;
  trackName: string;
};

const AmbientVolumeControl = ({
  fineVolume,
  initialVolume,
  libraryItemId,
  sliderWidth,
  trackName,
}: AmbientVolumeControlProps) => {
  const themeColors = useThemeColors();
  const [draftVolume, setDraftVolume] = useState(initialVolume);
  const maximumVolume = fineVolume ? 0.5 : 1;

  return (
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
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
            Ambient Volume
          </Text>
          <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
            {trackName} · {formatVolumeLabel(draftVolume)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}
          >
            Fine Volume
          </Text>
          <Switch
            accessibilityLabel="Toggle fine volume"
            value={fineVolume}
            style={{ transform: [{ scale: 0.75 }] }}
            onValueChange={(value) => {
              const nextVolume = value ? Math.min(draftVolume, 0.5) : draftVolume;
              setDraftVolume(nextVolume);
              ambientService.setPreferenceFineVolumeForBook(libraryItemId, value);
            }}
            trackColor={{ false: themeColors.border, true: themeColors.accent }}
            thumbColor={themeColors.surface}
          />
        </View>
      </View>
      <SliderWithBubble
        bubbleLabel={formatVolumeLabel(draftVolume)}
        bubbleMinWidth={76}
        style={{ width: sliderWidth, alignSelf: "center" }}
        minimumTrackTintColor={themeColors.accent}
        maximumTrackTintColor={themeColors.border}
        thumbTintColor={themeColors.accent}
        minimumValue={0}
        maximumValue={maximumVolume}
        step={0.01}
        value={draftVolume}
        onValueChange={(value: number) => setDraftVolume(value)}
        onSlidingComplete={(value: number) => {
          setDraftVolume(value);
          ambientService.setPreferenceVolumeForBook(libraryItemId, value);
        }}
      />
    </View>
  );
};

const PlayerAmbientSheet = () => {
  const themeColors = useThemeColors();
  const { width } = useWindowDimensions();
  const currentLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const hasLoadedBook = usePlaybackStore(
    (state) => Boolean(state.libraryItemId) && state.queue.length > 0,
  );
  const isEnabled = useAmbientStore((state) => state.isEnabled);
  const trackOrder = useAmbientStore((state) => state.trackOrder);
  const tracksById = useAmbientStore((state) => state.tracksById);
  const attachedTrack = useAmbientStore((state) =>
    selectAttachedAmbientTrackForBook(state, currentLibraryItemId),
  );
  const ambientPreference = useAmbientStore((state) =>
    selectAmbientPlaybackPreferenceForBook(state, currentLibraryItemId),
  );
  const allTracks = useMemo(
    () => trackOrder.map((trackId) => tracksById[trackId]).filter(Boolean),
    [trackOrder, tracksById],
  );
  const ambientTracks = useMemo(
    () => allTracks.filter((track) => isAmbientTrackAvailable(track)),
    [allTracks],
  );
  const orderedAmbientTracks = useMemo(
    () => sortSelectedAmbientTrackFirst(ambientTracks, attachedTrack?.id),
    [ambientTracks, attachedTrack?.id],
  );
  const [positionSnapshot, setPositionSnapshot] = useState(() =>
    ambientService.getPositionSnapshotForBook(currentLibraryItemId),
  );
  const totalTrackCount = allTracks.length;
  const canAttachTrack = Boolean(currentLibraryItemId) && hasLoadedBook;
  const sliderWidth = Math.max(220, width - 96);

  useFocusEffect(
    useCallback(() => {
      setPositionSnapshot(ambientService.getPositionSnapshotForBook(currentLibraryItemId));
    }, [currentLibraryItemId]),
  );
  const helperText = useMemo(() => {
    if (!canAttachTrack) return "Load a book before attaching ambient audio.";
    if (ambientTracks.length > 0) return "Choose a track to start looped ambient playback.";
    if (totalTrackCount > 0) {
      return "Your saved ambient tracks are from an older build and are unavailable. Re-import them from Settings > Ambient Audio.";
    }
    return "Import tracks from Settings > Ambient Audio before using ambient playback here.";
  }, [ambientTracks.length, canAttachTrack, totalTrackCount]);

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
        {isEnabled && attachedTrack && ambientPreference ? (
          <AmbientVolumeControl
            key={[
              currentLibraryItemId ?? "none",
              ambientPreference.trackId,
              ambientPreference.fineVolume,
              ambientPreference.volume,
            ].join(":")}
            fineVolume={ambientPreference.fineVolume}
            initialVolume={ambientPreference.volume}
            libraryItemId={currentLibraryItemId}
            sliderWidth={sliderWidth}
            trackName={attachedTrack.fileName}
          />
        ) : null}

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
            {orderedAmbientTracks.length ? (
              orderedAmbientTracks.map((track, index) => {
                const isSelected = attachedTrack?.id === track.id;
                const positionAtOpen =
                  isSelected && positionSnapshot?.trackId === track.id
                    ? positionSnapshot.positionMs
                    : null;
                return (
                  <Pressable
                    key={track.id}
                    disabled={!canAttachTrack}
                    onPress={() => {
                      ambientService.attachTrackToBook(track.id, currentLibraryItemId);
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderBottomWidth: index === orderedAmbientTracks.length - 1 ? 0 : 1,
                      borderBottomColor: themeColors.border,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      backgroundColor: isSelected ? themeColors.bg : themeColors.surface,
                      opacity: !canAttachTrack ? 0.45 : pressed ? 0.82 : 1,
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
                      {positionAtOpen !== null ? (
                        <Text selectable style={{ color: themeColors.textMuted, fontSize: 12 }}>
                          Position at open: {formatPositionLabel(positionAtOpen)}
                        </Text>
                      ) : null}
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
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                >
                  No ambient tracks available
                </Text>
                <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  {totalTrackCount > 0
                    ? "Re-import ambient audio from Settings > Ambient Audio to use it in this build."
                    : "Open Settings and import ambient audio from your device or iCloud Files."}
                </Text>
              </View>
            )}
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
