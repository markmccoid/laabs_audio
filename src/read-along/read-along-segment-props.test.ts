import { areSegmentPropsEqual } from "@/read-along/read-along-segment-props";

/**
 * These pin the memoization contract documented in `read-along-segment-props.ts`.
 * The callback cases are the load-bearing ones: they assert that the comparator
 * ignores handler identity, which is precisely why the screen must keep its
 * gesture handlers stable.
 */

const noop = () => {};

const baseProps = () => ({
  row: { id: 1, sectionIndex: 0, startMs: 0, endMs: 1000, text: "A sentence." },
  isActive: false,
  isSelected: false,
  fontSize: 18,
  palette: {
    text: "#000",
    activeTint: "rgba(0,0,0,0.13)",
    selectionTint: "rgba(0,0,0,0.28)",
    markerColor: "#00f",
    wordAppearance: null,
  },
  words: null,
  activeWordIndex: -1,
  markers: [] as const,
  onPress: noop,
  onLongPress: noop,
  onPressMarker: noop,
});

describe("areSegmentPropsEqual", () => {
  it("skips a re-render when nothing meaningful changed", () => {
    const previous = baseProps();
    expect(areSegmentPropsEqual(previous, { ...previous })).toBe(true);
  });

  it("ignores handler identity — callers MUST keep handlers stable", () => {
    const previous = baseProps();
    expect(
      areSegmentPropsEqual(previous, {
        ...previous,
        onPress: () => {},
        onLongPress: () => {},
        onPressMarker: () => {},
      }),
    ).toBe(true);
  });

  it("re-renders when the segment enters or leaves the selection", () => {
    const previous = baseProps();
    expect(areSegmentPropsEqual(previous, { ...previous, isSelected: true })).toBe(false);
  });

  it("re-renders when the row's bookmark markers change identity", () => {
    const previous = baseProps();
    expect(areSegmentPropsEqual(previous, { ...previous, markers: [] })).toBe(false);
  });

  it("re-renders when the segment becomes active", () => {
    const previous = baseProps();
    expect(areSegmentPropsEqual(previous, { ...previous, isActive: true })).toBe(false);
  });

  it("ignores word ticks while the segment is inactive", () => {
    const previous = baseProps();
    expect(areSegmentPropsEqual(previous, { ...previous, activeWordIndex: 4 })).toBe(true);
  });

  it("honours word ticks while the segment is active", () => {
    const previous = { ...baseProps(), isActive: true };
    expect(areSegmentPropsEqual(previous, { ...previous, activeWordIndex: 4 })).toBe(false);
  });

  it("re-renders on a font size or palette change", () => {
    const previous = baseProps();
    expect(areSegmentPropsEqual(previous, { ...previous, fontSize: 20 })).toBe(false);
    expect(
      areSegmentPropsEqual(previous, { ...previous, palette: { ...previous.palette } }),
    ).toBe(false);
  });
});
