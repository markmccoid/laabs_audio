import { playbackStore } from "@/player/playback-store";
import { interpolatePosition } from "@/read-along/read-along-sync";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState } from "react-native";
import {
  resolvePdfParagraph,
  type TimedPdfParagraph,
} from "./pdf-paragraph-sync";

/** At most one timer, aimed at a paragraph start/end; player ticks re-anchor it without changing the box. */
export const usePdfPlaybackParagraph = (
  bookId: string,
  paragraphs: readonly TimedPdfParagraph[],
  enabled: boolean,
): TimedPdfParagraph | null => {
  const [paragraph, setParagraph] = useState<TimedPdfParagraph | null>(null);
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let anchorOverrideMs = 0;
      let positionOverrideMs: number | null = null;
      const sync = () => {
        if (timer) clearTimeout(timer);
        const state = playbackStore.getState();
        if (
          !enabled ||
          AppState.currentState !== "active" ||
          state.libraryItemId !== bookId
        ) {
          setParagraph(null);
          return;
        }
        const playing =
          state.playbackState === "playing" && state.positionUpdatedAtMs > 0;
        const position = interpolatePosition(
          {
            positionMs: positionOverrideMs ?? state.positionMs,
            anchoredAtMs: Math.max(state.positionUpdatedAtMs, anchorOverrideMs),
            rate: state.rate,
            isPlaying: playing,
          },
          Date.now(),
        );
        const resolved = resolvePdfParagraph(paragraphs, position);
        setParagraph(resolved.paragraph);
        if (!playing || resolved.nextBoundaryMs === null) return;
        const rate = state.rate > 0 ? state.rate : 1;
        timer = setTimeout(
          sync,
          Math.min(
            60_000,
            Math.max(10, (resolved.nextBoundaryMs - position) / rate),
          ),
        );
      };
      const unsubscribe = playbackStore.subscribe((state, previous) => {
        // Play/seek can arrive before the next engine tick. Do not extrapolate across a pause
        // or apply the old tick timestamp to a newly sought position.
        const nowMs = Date.now();
        if (state.positionUpdatedAtMs !== previous.positionUpdatedAtMs) {
          anchorOverrideMs = 0;
          positionOverrideMs = null;
        } else if (
          state.positionMs !== previous.positionMs ||
          (state.playbackState === "playing" &&
            previous.playbackState !== "playing")
        ) {
          anchorOverrideMs = nowMs;
          positionOverrideMs = state.positionMs;
        } else if (
          state.rate !== previous.rate &&
          state.playbackState === "playing"
        ) {
          positionOverrideMs = interpolatePosition(
            {
              positionMs: positionOverrideMs ?? previous.positionMs,
              anchoredAtMs: Math.max(
                previous.positionUpdatedAtMs,
                anchorOverrideMs,
              ),
              rate: previous.rate,
              isPlaying: previous.playbackState === "playing",
            },
            nowMs,
          );
          anchorOverrideMs = nowMs;
        }
        if (
          state.positionMs !== previous.positionMs ||
          state.positionUpdatedAtMs !== previous.positionUpdatedAtMs ||
          state.rate !== previous.rate ||
          state.playbackState !== previous.playbackState ||
          state.libraryItemId !== previous.libraryItemId
        )
          sync();
      });
      const appState = AppState.addEventListener("change", sync);
      sync();
      return () => {
        unsubscribe();
        appState.remove();
        if (timer) clearTimeout(timer);
      };
    }, [bookId, paragraphs, enabled]),
  );
  return enabled ? paragraph : null;
};
