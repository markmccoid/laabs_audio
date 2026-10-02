import { playbackStore } from "@/player/playback-store";
import { interpolatePosition } from "@/read-along/read-along-sync";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { resolvePdfPage, type TimedPdfPage } from "./pdf-page-sync";

/** One wakeup at the next page boundary, re-anchored by the player's normal position ticks. */
export const usePdfPlaybackPage = (
  bookId: string,
  pages: readonly TimedPdfPage[],
  enabled: boolean,
): number | null => {
  const [page, setPage] = useState<number | null>(null);
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
          setPage(null);
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
        setPage(resolvePdfPage(pages, position)?.p ?? null);
        if (!playing) return;
        const next = pages.find(
          (candidate) => candidate.timing.startMs > position,
        );
        if (!next) return;
        const rate = state.rate > 0 ? state.rate : 1;
        timer = setTimeout(
          sync,
          Math.min(
            60_000,
            Math.max(10, (next.timing.startMs - position) / rate),
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
    }, [bookId, pages, enabled]),
  );
  return page;
};
