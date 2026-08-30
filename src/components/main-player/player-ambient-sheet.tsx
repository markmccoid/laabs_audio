import { useAmbientProgressStore } from "@/ambient/ambient-progress-store";
import { ambientService } from "@/ambient/ambient-service";
import SliderWithBubble from "@/components/sliders/slider-with-bubble";
import { usePlaybackStore } from "@/player";
import {
  isAmbientTrackAvailable,
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

type AmbientNowPlayingCardProps = {
  libraryItemId: string | null;
  trackId: string;
  trackName: string;
};

/** Header card for the track attached to the current book. */
const AmbientNowPlayingCard = ({
  libraryItemId,
  trackId,
  trackName,
}: AmbientNowPlayingCardProps) => {
  const themeColors = useThemeColors();
  const isActiveSession = useAmbientStore(
    (state) => state.activeTrackId === trackId && state.activeLibraryItemId === libraryItemId,
  );
  const playbackState = useAmbientStore((state) => state.playbackState);
  const statusLabel = !isActiveSession
    ? "Not loaded"
    : playbackState === "playing"
      ? "Playing"
      : playbackState === "paused"
        ? "Paused"
        : "Stopped";

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
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: themeColors.accent,
        }}
      >
        <SymbolView
          name="speaker.wave.2.fill"
          size={20}
          tintColor={themeColors.accentForeground}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          selectable
          style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}
        >
          Ambient Track
        </Text>
        <Text
          selectable
          numberOfLines={1}
          style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}
        >
          {trackName}
        </Text>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          {statusLabel}
        </Text>
      </View>
    </View>
  );
};

type AmbientPositionControlProps = {
  fallbackDurationMs: number;
  fallbackPositionMs: number;
  libraryItemId: string | null;
  sliderWidth: number;
  trackId: string;
};

/**
 * Live position readout and scrubber for the attached ambient bed.
 *
 * The 1Hz subscription is deliberately isolated in this leaf so a ticking
 * position does not rerender the sheet header or the track list every second.
 */
const AmbientPositionControl = ({
  fallbackDurationMs,
  fallbackPositionMs,
  libraryItemId,
  sliderWidth,
  trackId,
}: AmbientPositionControlProps) => {
  const themeColors = useThemeColors();
  // Primitive selectors, so an unrelated session publishing progress cannot
  // rerender this control.
  const livePositionMs = useAmbientProgressStore((state) =>
    state.trackId === trackId && state.libraryItemId === libraryItemId ? state.positionMs : null,
  );
  const liveDurationMs = useAmbientProgressStore((state) =>
    state.trackId === trackId && state.libraryItemId === libraryItemId ? state.durationMs : 0,
  );
  const [isSliding, setIsSliding] = useState(false);
  const [draftPositionMs, setDraftPositionMs] = useState(0);

  // The live duration is 0 until the native item is ready; the stored loop
  // length from an earlier session covers that gap.
  const durationMs = Math.max(liveDurationMs, fallbackDurationMs, 0);
  // With no live session (book unloaded, or the player torn down by an error)
  // the stored resume position is the truth, and nothing is advancing it.
  const trackedPositionMs = Math.max(livePositionMs ?? fallbackPositionMs, 0);
  const positionMs = durationMs > 0 ? Math.min(trackedPositionMs, durationMs) : trackedPositionMs;
  const sliderValue = isSliding ? draftPositionMs : positionMs;
  const canSeek = durationMs > 0;

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
      <View style={{ gap: 4 }}>
        <Text selectable style={{ color: themeColors.text, fontSize: 16, fontWeight: "700" }}>
          Ambient Position
        </Text>
        <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
          {canSeek
            ? "Drag to move the loop to a different point."
            : "Available once the track reports its length."}
        </Text>
      </View>
      <SliderWithBubble
        bubbleLabel={formatPositionLabel(sliderValue)}
        bubbleMinWidth={76}
        style={{ width: sliderWidth, alignSelf: "center" }}
        minimumTrackTintColor={canSeek ? themeColors.accent : themeColors.textMuted}
        maximumTrackTintColor={themeColors.border}
        thumbTintColor={canSeek ? themeColors.accent : themeColors.textMuted}
        disabled={!canSeek}
        minimumValue={0}
        maximumValue={canSeek ? durationMs : 1}
        step={1000}
        value={sliderValue}
        onSlidingStart={() => {
          setDraftPositionMs(positionMs);
          setIsSliding(true);
        }}
        onValueChange={(value: number) => setDraftPositionMs(value)}
        onSlidingComplete={(value: number) => {
          setDraftPositionMs(value);
          setIsSliding(false);
          if (!canSeek) return;
          ambientService.seekToPositionForBook(libraryItemId, value);
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text
          selectable
          style={{ color: themeColors.text, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}
        >
          {formatPositionLabel(sliderValue)}
        </Text>
        <Text
          selectable
          style={{ color: themeColors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}
        >
          {canSeek ? formatPositionLabel(durationMs) : "--:--"}
        </Text>
      </View>
    </View>
  );
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
  const otherAmbientTracks = useMemo(
    () => ambientTracks.filter((track) => track.id !== attachedTrack?.id),
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
          <AmbientNowPlayingCard
            libraryItemId={currentLibraryItemId}
            trackId={attachedTrack.id}
            trackName={attachedTrack.fileName}
          />
        ) : null}

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

        {isEnabled && attachedTrack && ambientPreference ? (
          <AmbientPositionControl
            key={attachedTrack.id}
            fallbackDurationMs={attachedTrack.durationMs ?? 0}
            fallbackPositionMs={
              positionSnapshot?.trackId === attachedTrack.id
                ? positionSnapshot.positionMs
                : ambientPreference.positionMs
            }
            libraryItemId={currentLibraryItemId}
            sliderWidth={sliderWidth}
            trackId={attachedTrack.id}
          />
        ) : null}

        {isEnabled && attachedTrack && otherAmbientTracks.length ? (
          <Text
            selectable
            style={{ color: themeColors.textMuted, fontSize: 12, fontWeight: "700" }}
          >
            Other Tracks
          </Text>
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
            {otherAmbientTracks.length ? (
              otherAmbientTracks.map((track, index) => {
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
                      borderBottomWidth: index === otherAmbientTracks.length - 1 ? 0 : 1,
                      borderBottomColor: themeColors.border,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      backgroundColor: themeColors.surface,
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
                        backgroundColor: themeColors.bg,
                      }}
                    >
                      <SymbolView name="waveform" size={18} tintColor={themeColors.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        selectable
                        numberOfLines={1}
                        style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                      >
                        {track.fileName}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <View style={{ paddingHorizontal: 16, paddingVertical: 18, gap: 6 }}>
                <Text
                  selectable
                  style={{ color: themeColors.text, fontSize: 15, fontWeight: "600" }}
                >
                  {attachedTrack ? "No other ambient tracks" : "No ambient tracks available"}
                </Text>
                <Text selectable style={{ color: themeColors.textMuted, fontSize: 13 }}>
                  {attachedTrack
                    ? "Import more ambient audio from Settings > Ambient Audio to switch between beds."
                    : totalTrackCount > 0
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
