import { playbackStore, playerService, usePlaybackStore } from "@/player";
import {
  buildReadAlongRateLadder,
  isSameRate,
} from "@/read-along/read-along-rate-ladder";
import { useBookPlaybackRate } from "@/store/device-books-store";
import { useSettingsStore } from "@/store/settings-store";
import type { ThemeColors } from "@/theme/use-app-theme";
import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { ReadAlongPopoverBackdrop } from "./read-along-popover-backdrop";

/**
 * The Read-Along footer overlay (`docs/read-along-implementation-plan.md`
 * Phase 3.3): play/pause plus skip back/forward, so the reader never has to
 * leave the view.
 *
 * Subscribes to the playback store itself so a play/pause change re-renders the
 * footer and nothing else — the transcript list must not re-render for it.
 *
 * The skip seconds are the user's configured ones, read from settings exactly
 * as `book-controls` does, so the icons and the jump agree with the player.
 *
 * The trailing rate pill is positioned absolutely rather than joining the row,
 * so the play button stays optically centred — it is the one control people hit
 * without looking.
 */

/** Every rate surface in the app renders this way; the reader matches it. */
const formatRate = (rate: number) => `${rate.toFixed(2)}x`;

/**
 * How far the rate menu lifts to clear the "Resume following" pill.
 *
 * Both float above the bar at the same offset, and the menu is wide enough to
 * cover the pill's trailing third and clip its label mid-word. The menu yields
 * because it is the transient one — the pill is a state indicator the reader may
 * still need to see and press.
 */
const RESUME_PILL_CLEARANCE = 42;

const resolveSeekBackwardIcon = (seconds: number): SFSymbol => {
  switch (Math.round(seconds)) {
    case 10:
      return "gobackward.10";
    case 15:
      return "gobackward.15";
    case 30:
      return "gobackward.30";
    case 45:
      return "gobackward.45";
    case 60:
      return "gobackward.60";
    default:
      return "gobackward";
  }
};

const resolveSeekForwardIcon = (seconds: number): SFSymbol => {
  switch (Math.round(seconds)) {
    case 10:
      return "goforward.10";
    case 15:
      return "goforward.15";
    case 30:
      return "goforward.30";
    case 45:
      return "goforward.45";
    case 60:
      return "goforward.60";
    default:
      return "goforward";
  }
};

type ReadAlongControlsProps = {
  boundLibraryItemId: string;
  themeColors: ThemeColors;
  bottomInset: number;
  /** Whether the screen is currently floating its "Resume following" pill. */
  isResumePillVisible: boolean;
};

const ControlButton = ({
  icon,
  label,
  onPress,
  disabled,
  tintColor,
  size = 26,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  disabled: boolean;
  tintColor: string;
  size?: number;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => ({
      width: 48,
      height: 48,
      borderRadius: 24,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    })}
  >
    <SymbolView name={icon} size={size} tintColor={tintColor} />
  </Pressable>
);

const RateMenuRow = ({
  label,
  isSelected,
  onPress,
  themeColors,
  isMuted = false,
}: {
  label: string;
  isSelected: boolean;
  onPress: () => void;
  themeColors: ThemeColors;
  isMuted?: boolean;
}) => (
  <Pressable
    accessibilityRole={isMuted ? "button" : "radio"}
    accessibilityLabel={label}
    accessibilityState={isMuted ? undefined : { selected: isSelected, checked: isSelected }}
    onPress={onPress}
    style={({ pressed }) => ({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 10,
      borderCurve: "continuous",
      paddingVertical: 7,
      paddingHorizontal: 8,
      backgroundColor: isSelected ? themeColors.bg : "transparent",
      opacity: pressed ? 0.7 : 1,
    })}
  >
    <Text
      style={{
        flex: 1,
        fontSize: 14,
        fontWeight: isSelected ? "700" : "400",
        color: isMuted ? themeColors.textMuted : themeColors.text,
        fontVariant: ["tabular-nums"],
      }}
    >
      {label}
    </Text>
    <View style={{ width: 16, alignItems: "center" }}>
      {isSelected ? (
        <SymbolView name="checkmark" size={13} tintColor={themeColors.accent} />
      ) : null}
    </View>
  </Pressable>
);

export const ReadAlongControls = ({
  boundLibraryItemId,
  themeColors,
  bottomInset,
  isResumePillVisible,
}: ReadAlongControlsProps) => {
  const colorScheme = useColorScheme();
  const seekBackwardSeconds = useSettingsStore((state) => state.seekBackwardSeconds);
  const seekForwardSeconds = useSettingsStore((state) => state.seekForwardSeconds);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playingLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const playbackRate = usePlaybackStore((state) => state.rate);
  const playbackRateRangeMin = useSettingsStore((state) => state.playbackRateRangeMin);
  const playbackRateRangeMax = useSettingsStore((state) => state.playbackRateRangeMax);
  const storedRate = useBookPlaybackRate(boundLibraryItemId);
  const [isRateMenuOpen, setIsRateMenuOpen] = useState(false);

  const isBoundBookLoaded = playingLibraryItemId === boundLibraryItemId && queueLength > 0;
  const isPlaying = isBoundBookLoaded && playbackState === "playing";
  // Skips only make sense against the bound book; when the player holds another
  // book (or nothing) the play button becomes "start this book" instead.
  const canSkip = isBoundBookLoaded && (playbackState === "playing" || playbackState === "paused");

  // The live rate once the book is loaded, its saved rate before that — the
  // pill states the truth in both cases, it is only actionable in the first.
  const currentRate = isBoundBookLoaded ? playbackRate : storedRate;
  const rateLadder = useMemo(
    () => buildReadAlongRateLadder(playbackRateRangeMin, playbackRateRangeMax),
    [playbackRateRangeMax, playbackRateRangeMin],
  );

  const handleSelectRate = (nextRate: number) => {
    setIsRateMenuOpen(false);
    void playerService.setRate(nextRate).catch(() => {
      // The player reports its own failures; the reader stays put.
    });
  };

  const handleOpenFullRateSheet = () => {
    setIsRateMenuOpen(false);
    router.push({ pathname: "/player-rate", params: { libraryItemId: boundLibraryItemId } });
  };

  const handleToggle = () => {
    void (async () => {
      const state = playbackStore.getState();
      const isLoadedNow = state.libraryItemId === boundLibraryItemId && state.queue.length > 0;
      // idle / ended / another book loaded: restart the bound book, the same
      // load-if-needed path the chapter viewer uses for its seeks.
      if (!isLoadedNow) {
        await playerService.loadBook(boundLibraryItemId, { autoPlay: true });
        return;
      }
      if (state.playbackState === "playing") {
        await playerService.requestPause();
        return;
      }
      await playerService.requestPlay();
    })().catch(() => {
      // Playback surfaces its own failure toasts; the reader stays put.
    });
  };

  return (
    // Full-screen and pass-through: the bar is pinned to the bottom edge, and
    // the extra room above it is what the dismiss backdrop and the rate menu
    // need. Taps that hit neither fall through to the transcript.
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { justifyContent: "flex-end" }]}
    >
      {isRateMenuOpen ? (
        <ReadAlongPopoverBackdrop onPress={() => setIsRateMenuOpen(false)} />
      ) : null}

      {isRateMenuOpen ? (
        <View
          style={{
            position: "absolute",
            right: 12,
            bottom:
              Math.max(bottomInset, 10) +
              80 +
              (isResumePillVisible ? RESUME_PILL_CLEARANCE : 0),
            width: 150,
            gap: 2,
            borderRadius: 16,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
            paddingVertical: 8,
            paddingHorizontal: 8,
            boxShadow: "0 12px 24px rgba(15, 23, 42, 0.18)",
          }}
        >
          <View accessibilityRole="radiogroup" accessibilityLabel="Playback speed">
            {rateLadder.map((rate) => (
              <RateMenuRow
                key={rate}
                label={formatRate(rate)}
                isSelected={isSameRate(rate, currentRate)}
                onPress={() => handleSelectRate(rate)}
                themeColors={themeColors}
              />
            ))}
          </View>
          <View style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 4 }} />
          {/* Anything off the ladder — including the rate the book is on right
              now, if a slider put it there — is reachable here. */}
          <RateMenuRow
            label="More…"
            isSelected={false}
            isMuted
            onPress={handleOpenFullRateSheet}
            themeColors={themeColors}
          />
        </View>
      ) : null}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: themeColors.border,
          overflow: "hidden",
        }}
      >
        <BlurView
          tint={colorScheme === "dark" ? "dark" : "light"}
          intensity={80}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            paddingTop: 8,
            paddingBottom: Math.max(bottomInset, 10),
          }}
        >
          <ControlButton
            icon={resolveSeekBackwardIcon(seekBackwardSeconds)}
            label={`Skip back ${seekBackwardSeconds} seconds`}
            onPress={() => void playerService.skipBy(seekBackwardSeconds, true)}
            disabled={!canSkip}
            tintColor={themeColors.text}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            onPress={handleToggle}
            style={({ pressed }) => ({
              width: 56,
              height: 56,
              borderRadius: 28,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: themeColors.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <SymbolView
              name={isPlaying ? "pause.fill" : "play.fill"}
              size={24}
              tintColor={themeColors.accentForeground}
            />
          </Pressable>
          <ControlButton
            icon={resolveSeekForwardIcon(seekForwardSeconds)}
            label={`Skip forward ${seekForwardSeconds} seconds`}
            onPress={() => void playerService.skipBy(seekForwardSeconds)}
            disabled={!canSkip}
            tintColor={themeColors.text}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Playback speed ${formatRate(currentRate)}`}
            accessibilityState={{ disabled: !isBoundBookLoaded, expanded: isRateMenuOpen }}
            disabled={!isBoundBookLoaded}
            onPress={() => setIsRateMenuOpen((open) => !open)}
            hitSlop={8}
            style={({ pressed }) => ({
              position: "absolute",
              right: 16,
              top: 8,
              height: 56,
              justifyContent: "center",
              opacity: !isBoundBookLoaded ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                borderRadius: 999,
                borderCurve: "continuous",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: themeColors.border,
                backgroundColor: isRateMenuOpen ? themeColors.bg : themeColors.surface,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: themeColors.text,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatRate(currentRate)}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
};
