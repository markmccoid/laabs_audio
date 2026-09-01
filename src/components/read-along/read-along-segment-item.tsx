import type {
  TranscriptSegmentTextRow,
  TranscriptSegmentWordTiming,
} from "@/data/sqlite/shadow-db-transcripts";
import {
  buildWordSpans,
  type ReadAlongWordAppearance,
} from "@/read-along/read-along-rendering";
import { memo, useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * One Transcript Segment in the Read-Along reader
 * (`docs/read-along-implementation-plan.md` Phase 3.2).
 *
 * ## Memoization contract (load-bearing)
 *
 * The word highlight ticks 2-4 times a second. Every one of those ticks must
 * re-render **exactly one** item — the active one — or a 5k-segment book pays
 * for the whole viewport on every word.
 *
 * That is what {@link areSegmentPropsEqual} enforces: an item re-renders only
 * when `row.id`, `isActive`, `fontSize` or `palette` change, and word-level
 * props (`words`, `activeWordIndex`) are compared **only while the item is
 * active**. Inactive items therefore ignore word ticks entirely, even though
 * the screen passes the same props down to every row.
 *
 * The consequences for callers:
 * - `palette` must be a memoized object, not rebuilt per render. The chosen
 *   word highlight style rides inside it, so changing the style re-renders
 *   every visible row exactly once and needs no extra prop.
 * - `onPress` must be a stable identity (it is intentionally not compared).
 * - Never add a prop that changes per tick without extending the comparator.
 */

export type ReadAlongSegmentPalette = {
  text: string;
  /** Accent at ~13% — the active segment's tint. */
  activeTint: string;
  /**
   * How to mark the active word, already resolved from the user's chosen
   * highlight style. `null` means the word gets no treatment (`none`).
   *
   * It rides in the palette rather than arriving as its own prop so the memo
   * comparator below needs no new branch — see the contract above.
   */
  wordAppearance: ReadAlongWordAppearance | null;
};

/** Matches the plan's "gentle cross-fade" on the segment tint. */
const TINT_FADE_DURATION_MS = 220;
const LINE_HEIGHT_RATIO = 1.5;

type ReadAlongSegmentItemProps = {
  row: TranscriptSegmentTextRow;
  isActive: boolean;
  fontSize: number;
  palette: ReadAlongSegmentPalette;
  /** Word timings for THIS segment, or null (segment-tint-only mode). */
  words: readonly TranscriptSegmentWordTiming[] | null;
  activeWordIndex: number;
  onPress: (row: TranscriptSegmentTextRow) => void;
};

const ReadAlongSegmentItemBase = ({
  row,
  isActive,
  fontSize,
  palette,
  words,
  activeWordIndex,
  onPress,
}: ReadAlongSegmentItemProps) => {
  const tintProgress = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    tintProgress.value = withTiming(isActive ? 1 : 0, { duration: TINT_FADE_DURATION_MS });
  }, [isActive, tintProgress]);

  const tintStyle = useAnimatedStyle(() => ({ opacity: tintProgress.value }));

  // Only the active segment ever has word timings, so this alignment work runs
  // for one item at a time.
  const spans = useMemo(
    () => (isActive ? buildWordSpans(row.text, words) : null),
    [isActive, row.text, words],
  );

  const textStyle = {
    fontSize,
    lineHeight: Math.round(fontSize * LINE_HEIGHT_RATIO),
    color: palette.text,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.text}
      accessibilityHint="Play from here"
      onPress={() => onPress(row)}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      <View style={styles.block}>
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, { backgroundColor: palette.activeTint }, tintStyle]}
        />
        <Text style={textStyle}>
          {spans
            ? spans.map((span, index) =>
                span.wordIndex === activeWordIndex &&
                span.wordIndex >= 0 &&
                palette.wordAppearance ? (
                  <Text key={index} style={palette.wordAppearance}>
                    {span.text}
                  </Text>
                ) : (
                  span.text
                ),
              )
            : row.text}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  block: {
    position: "relative",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  tint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    borderCurve: "continuous",
  },
});

export const areSegmentPropsEqual = (
  previous: ReadAlongSegmentItemProps,
  next: ReadAlongSegmentItemProps,
) => {
  if (
    previous.row.id !== next.row.id ||
    previous.isActive !== next.isActive ||
    previous.fontSize !== next.fontSize ||
    previous.palette !== next.palette
  ) {
    return false;
  }
  // Word props only matter to the segment that is actually showing them.
  if (!next.isActive) return true;
  return previous.words === next.words && previous.activeWordIndex === next.activeWordIndex;
};

export const ReadAlongSegmentItem = memo(ReadAlongSegmentItemBase, areSegmentPropsEqual);
