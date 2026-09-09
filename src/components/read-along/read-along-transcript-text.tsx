import { usePlaybackStore } from "@/player/playback-store";
import {
  buildWordRanges,
  buildWordSpans,
  getWordHighlightWindow,
} from "@/read-along/read-along-rendering";
import type { ReadAlongSegmentItemProps } from "@/read-along/read-along-segment-props";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions, type ViewProps } from "react-native";

type NativeTextProps = ViewProps & {
  contentId: string;
  text: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  wordColor: string | null;
  highlightColor: string | null;
  boldWord: boolean;
  wordRanges: [number, number][];
  activeWordIndex: number;
  highlightWordCount: number;
  playbackRate: number;
  onContentSize: (event: {
    nativeEvent: { contentId: string; width: number; height: number };
  }) => void;
};

// Old development builds and other platforms remain usable until the native
// module is compiled. iOS uses one TextKit layout for both ink and backdrops.
const NativeText =
  Platform.OS === "ios" && requireOptionalNativeModule("ReadAlongText")
    ? requireNativeView<NativeTextProps>("ReadAlongText")
    : null;

type Props = Pick<
  ReadAlongSegmentItemProps,
  "row" | "isActive" | "fontSize" | "palette" | "words" | "activeWordIndex"
  | "wordHighlightCount"
>;

export const ReadAlongTranscriptText = ({
  row,
  isActive,
  fontSize,
  palette,
  words,
  activeWordIndex,
  wordHighlightCount,
}: Props) => {
  const { fontScale } = useWindowDimensions();
  const playbackRate = usePlaybackStore((state) => (isActive ? state.rate : 1));
  const spans = useMemo(
    () => (isActive ? buildWordSpans(row.text, words) : null),
    [isActive, row.text, words],
  );
  const wordRanges = useMemo(() => buildWordRanges(spans), [spans]);
  const highlightWindow = useMemo(
    () => getWordHighlightWindow(spans, activeWordIndex, wordHighlightCount),
    [activeWordIndex, spans, wordHighlightCount],
  );
  const lineHeight = Math.round(fontSize * 1.5);
  const contentId = JSON.stringify([row.id, row.text, fontSize, fontScale]);
  const [measurement, setMeasurement] = useState<{
    contentId: string;
    width: number;
    height: number;
  } | null>(null);
  const textStyle = { fontSize, lineHeight, color: palette.text };
  const nativeHeight = measurement?.contentId === contentId ? measurement.height : undefined;

  const fallbackText = (
    <Text style={textStyle}>
      {spans
        ? spans.map((span, index) =>
            span.wordIndex >= highlightWindow.startIndex &&
            span.wordIndex < highlightWindow.startIndex + highlightWindow.wordCount &&
            span.wordIndex >= 0 &&
            palette.wordAppearance ? (
              <Text key={index} style={palette.wordAppearance}>{span.text}</Text>
            ) : span.text,
          )
        : row.text}
    </Text>
  );

  if (!NativeText) return fallbackText;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: nativeHeight }}
    >
      {/* Seed the first layout with native RN prose measurement. Once TextKit
          reports its height it owns sizing too; word ticks never remount it. */}
      {nativeHeight === undefined ? <View style={styles.measurement}>{fallbackText}</View> : null}
      <NativeText
        style={StyleSheet.absoluteFill}
        contentId={contentId}
        text={row.text}
        fontSize={fontSize * fontScale}
        lineHeight={lineHeight * fontScale}
        textColor={palette.text}
        wordColor={palette.wordAppearance?.color ?? null}
        highlightColor={palette.wordAppearance?.backgroundColor ?? null}
        boldWord={palette.wordAppearance?.fontWeight === "600"}
        wordRanges={wordRanges}
        activeWordIndex={isActive ? highlightWindow.startIndex : -1}
        highlightWordCount={isActive ? highlightWindow.wordCount : 0}
        playbackRate={playbackRate}
        onContentSize={({ nativeEvent }) => {
          if (nativeEvent.contentId !== contentId || !Number.isFinite(nativeEvent.height)) return;
          setMeasurement((previous) =>
            previous?.contentId === nativeEvent.contentId &&
            previous.width === nativeEvent.width && previous.height === nativeEvent.height
              ? previous
              : nativeEvent,
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({ measurement: { opacity: 0 } });
