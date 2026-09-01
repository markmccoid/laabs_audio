import { Pressable, useWindowDimensions } from "react-native";

/**
 * The invisible full-window layer that closes an open Read-Along popover.
 *
 * Both of the reader's popovers float over content that reacts to taps — the
 * transcript seeks playback when a segment is pressed — so without this, a tap
 * meant to dismiss the card would seek the book *and* leave the card open.
 * Swallowing that first tap is the whole job.
 *
 * It is sized from the window rather than stretched with `absoluteFill` because
 * its parent is not always the screen: the header's popover hangs off a padded
 * header view, so `offsetTop`/`offsetLeft` walk the layer back to the window's
 * origin. The overscan then covers the difference between measuring those
 * offsets from the parent's padding box and its border box — an invisible layer
 * costs nothing to oversize, and a dead strip along one edge would silently
 * leak dismiss taps through to the transcript underneath.
 */

const OVERSCAN = 48;
export const ReadAlongPopoverBackdrop = ({
  onPress,
  offsetTop = 0,
  offsetLeft = 0,
}: {
  onPress: () => void;
  offsetTop?: number;
  offsetLeft?: number;
}) => {
  const { width, height } = useWindowDimensions();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Dismiss"
      onPress={onPress}
      style={{
        position: "absolute",
        top: offsetTop - OVERSCAN,
        left: offsetLeft - OVERSCAN,
        width: width + OVERSCAN * 2,
        height: height + OVERSCAN * 2,
      }}
    />
  );
};
