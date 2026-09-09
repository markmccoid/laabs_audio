import { ReadAlongTranscriptText } from "./read-along-transcript-text";
import {
  areSegmentPropsEqual,
  type ReadAlongSegmentItemProps,
} from "@/read-along/read-along-segment-props";
import { memo, useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * One Transcript Segment in the Read-Along reader. Its props and the
 * memoization contract that governs when this re-renders live in
 * `@/read-along/read-along-segment-props` — read that before changing anything
 * here, and especially before adding a prop.
 */

/** Matches the plan's "gentle cross-fade" on the segment tint. */
const TINT_FADE_DURATION_MS = 220;

/**
 * The Bookmark Gutter's lane. Wide enough for two stacked markers, because
 * overlapping clips are ordinary once a reader has clipped the same passage
 * twice; a third is drawn on top of the second rather than widening the lane and
 * shoving the text around.
 */
const GUTTER_WIDTH = 14;
const MARKER_RULE_WIDTH = 3;
const MARKER_SPACING = 5;
const MAX_VISIBLE_MARKERS = 2;
/** The dot's diameter, sized to read as a marker rather than a stray glyph. */
const MARKER_DOT_SIZE = 6;

const ReadAlongSegmentItemBase = ({
  row,
  isActive,
  isSelected,
  fontSize,
  palette,
  words,
  activeWordIndex,
  wordHighlightCount,
  markers,
  onPress,
  onLongPress,
  onPressMarker,
}: ReadAlongSegmentItemProps) => {
  const tintProgress = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    tintProgress.value = withTiming(isActive ? 1 : 0, { duration: TINT_FADE_DURATION_MS });
  }, [isActive, tintProgress]);

  const tintStyle = useAnimatedStyle(() => ({ opacity: tintProgress.value }));

  const visibleMarkers = markers.slice(0, MAX_VISIBLE_MARKERS);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.text}
      accessibilityHint={isSelected ? "Shorten the selection to here" : "Play from here"}
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      <View style={styles.block}>
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, { backgroundColor: palette.activeTint }, tintStyle]}
        />
        {isSelected ? (
          <View
            pointerEvents="none"
            style={[styles.tint, { backgroundColor: palette.selectionTint }]}
          />
        ) : null}
        {visibleMarkers.map((marker, index) => (
          <Pressable
            key={marker.bookmarkId}
            accessibilityRole="button"
            accessibilityLabel={
              marker.kind === "clip" ? `Clip: ${marker.title}` : `Bookmark: ${marker.title}`
            }
            hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
            onPress={() => onPressMarker(marker)}
            style={[
              styles.marker,
              { left: index * (MARKER_RULE_WIDTH + MARKER_SPACING) },
            ]}
          >
            {marker.kind === "clip" ? (
              <View
                style={{
                  flex: 1,
                  width: MARKER_RULE_WIDTH,
                  backgroundColor: palette.markerColor,
                  // Cap the rule only where the clip actually begins and ends, so
                  // a run of segments reads as one continuous mark.
                  borderTopLeftRadius: marker.isRangeStart ? MARKER_RULE_WIDTH : 0,
                  borderTopRightRadius: marker.isRangeStart ? MARKER_RULE_WIDTH : 0,
                  borderBottomLeftRadius: marker.isRangeEnd ? MARKER_RULE_WIDTH : 0,
                  borderBottomRightRadius: marker.isRangeEnd ? MARKER_RULE_WIDTH : 0,
                }}
              />
            ) : (
              <View
                style={{
                  width: MARKER_DOT_SIZE,
                  height: MARKER_DOT_SIZE,
                  borderRadius: MARKER_DOT_SIZE / 2,
                  marginLeft: (MARKER_RULE_WIDTH - MARKER_DOT_SIZE) / 2,
                  backgroundColor: palette.markerColor,
                }}
              />
            )}
          </Pressable>
        ))}
        <ReadAlongTranscriptText
          row={row}
          isActive={isActive}
          fontSize={fontSize}
          palette={palette}
          words={words}
          activeWordIndex={activeWordIndex}
          wordHighlightCount={wordHighlightCount}
        />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  block: {
    position: "relative",
    paddingVertical: 6,
    paddingRight: 10,
    // The Bookmark Gutter lives in this padding; text starts after it whether or
    // not the segment carries a marker, so nothing shifts when one is added.
    paddingLeft: GUTTER_WIDTH + 6,
  },
  marker: {
    position: "absolute",
    top: 6,
    bottom: 6,
    width: MARKER_RULE_WIDTH,
    alignItems: "center",
    justifyContent: "center",
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

export const ReadAlongSegmentItem = memo(ReadAlongSegmentItemBase, areSegmentPropsEqual);
