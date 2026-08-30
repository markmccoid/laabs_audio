/**
 * Read-Along position hook (`docs/read-along-implementation-plan.md` Phase 2).
 *
 * Turns the player's 1 Hz position ticks into a smoothly advancing
 * `{ activeSegmentIndex, activeWordIndex }` pair using client-side
 * interpolation, without re-rendering at clock frequency:
 *
 * - The anchor `(positionMs, positionUpdatedAtMs, rate, playbackState)` comes
 *   straight from the playback store, so every store tick re-anchors and drift
 *   self-corrects once a second (seek / rate / state changes re-anchor too).
 * - A single 150 ms `setInterval` recomputes the interpolated position and both
 *   indexes, and calls `setState` **only when an index actually changes** — so
 *   React re-renders at word-boundary frequency (~2-4/s), not tick frequency.
 * - The interval runs only while playback is `playing`, the screen is focused,
 *   and the playing book is the bound book. Anything else leaves the last
 *   indexes frozen in place (paused) or cleared (mismatch).
 *
 * Deliberately a plain JS clock: a Reanimated frame-callback loop buys nothing
 * perceptible for prose word highlighting and costs worklet complexity. Do not
 * "upgrade" it (settled decision in the plan).
 */

import { usePlaybackStore } from "@/player/playback-store";
import type { TranscriptSegmentWordTiming } from "@/data/sqlite/shadow-db-transcripts";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findActiveSegmentIndex,
  findActiveWordIndex,
  interpolatePosition,
  NO_ACTIVE_INDEX,
  type ReadAlongPositionAnchor,
  type ReadAlongTimedRange,
} from "./read-along-sync";

/** Interpolation tick. 150 ms is perceptually smooth for word highlighting. */
export const READ_ALONG_TICK_MS = 150;

export type UseReadAlongPositionArgs = {
  /**
   * The book this Read-Along view is bound to. When the player is on a
   * different book (or nothing is loaded) highlighting stops entirely.
   */
  boundLibraryItemId: string | null;
  /**
   * Segment rows for the bound book, sorted by `startMs`. Keep the array
   * identity stable (state / `useMemo`); a fresh array each render only costs a
   * redundant recompute, never a re-render (the state is change-only).
   */
  segments: readonly ReadAlongTimedRange[];
  /**
   * Word timings for the **currently active** segment, or `null` while they are
   * loading / absent. The caller owns the lazy `getSegmentWords` fetch + LRU;
   * this hook only resolves an index into whatever it is handed. Word timings
   * are book-absolute, so briefly stale words simply resolve to no active word.
   */
  activeSegmentWords?: readonly TranscriptSegmentWordTiming[] | null;
};

export type UseReadAlongPositionResult = {
  /** Index into `segments`, or `NO_ACTIVE_INDEX` (-1) when nothing is active. */
  activeSegmentIndex: number;
  /** Index into `activeSegmentWords`, or `NO_ACTIVE_INDEX` (-1). */
  activeWordIndex: number;
  /**
   * True when the playing book is not the bound book — including "nothing is
   * loaded" (`libraryItemId === null`), since the store position then does not
   * describe the bound book either. While true both indexes are
   * `NO_ACTIVE_INDEX` and no interval runs. The caller decides whether to show
   * the "Now playing a different book" notice (only when the player actually
   * holds another book).
   */
  isBookMismatch: boolean;
  /**
   * Current interpolated book-absolute position, read on demand. Stable
   * identity; does not cause re-renders. Useful for tap-to-seek context and for
   * one-shot lookups (e.g. resolving a freshly loaded segment's words).
   */
  getPositionMs: () => number;
};

type ActiveIndexes = {
  activeSegmentIndex: number;
  activeWordIndex: number;
};

const NO_ACTIVE_INDEXES: ActiveIndexes = {
  activeSegmentIndex: NO_ACTIVE_INDEX,
  activeWordIndex: NO_ACTIVE_INDEX,
};

export const useReadAlongPosition = ({
  boundLibraryItemId,
  segments,
  activeSegmentWords = null,
}: UseReadAlongPositionArgs): UseReadAlongPositionResult => {
  const positionMs = usePlaybackStore((state) => state.positionMs);
  const positionUpdatedAtMs = usePlaybackStore((state) => state.positionUpdatedAtMs);
  const rate = usePlaybackStore((state) => state.rate);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const playingLibraryItemId = usePlaybackStore((state) => state.libraryItemId);

  const isPlaying = playbackState === "playing";
  const isBookMismatch = playingLibraryItemId !== boundLibraryItemId;

  const anchor = useMemo<ReadAlongPositionAnchor>(
    () => ({
      positionMs,
      anchoredAtMs: positionUpdatedAtMs,
      rate,
      // A store that has never written a position (fresh launch on a rehydrated
      // persisted position) has no wall clock to anchor to, so don't extrapolate
      // from 1970 — hold the raw position until the first real tick (<= 1 s).
      isPlaying: isPlaying && positionUpdatedAtMs > 0,
    }),
    [positionMs, positionUpdatedAtMs, rate, isPlaying],
  );

  // Latest inputs, so the interval callback and `getPositionMs` stay stable
  // identities instead of being rebuilt on every store tick. Written in the
  // effect below (never during render).
  const anchorRef = useRef(anchor);
  const segmentsRef = useRef(segments);
  const wordsRef = useRef(activeSegmentWords);
  const mismatchRef = useRef(isBookMismatch);

  const [indexes, setIndexes] = useState<ActiveIndexes>(NO_ACTIVE_INDEXES);

  const getPositionMs = useCallback(() => interpolatePosition(anchorRef.current, Date.now()), []);

  /** Recompute both indexes and commit only when one of them changed. */
  const syncIndexes = useCallback(() => {
    const next = mismatchRef.current
      ? NO_ACTIVE_INDEXES
      : (() => {
          const currentMs = interpolatePosition(anchorRef.current, Date.now());
          const words = wordsRef.current;
          return {
            activeSegmentIndex: findActiveSegmentIndex(segmentsRef.current, currentMs),
            activeWordIndex: words ? findActiveWordIndex(words, currentMs) : NO_ACTIVE_INDEX,
          };
        })();

    setIndexes((previous) =>
      previous.activeSegmentIndex === next.activeSegmentIndex &&
      previous.activeWordIndex === next.activeWordIndex
        ? previous
        : next,
    );
  }, []);

  const [isFocused, setIsFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // Re-anchor immediately: every store tick, seek, rate change, state change,
  // book change, and every time the caller hands over new segments/words.
  useEffect(() => {
    anchorRef.current = anchor;
    segmentsRef.current = segments;
    wordsRef.current = activeSegmentWords;
    mismatchRef.current = isBookMismatch;
    syncIndexes();
  }, [anchor, segments, activeSegmentWords, isBookMismatch, syncIndexes]);

  useEffect(() => {
    if (!isPlaying || !isFocused || isBookMismatch) return;

    const intervalId = setInterval(syncIndexes, READ_ALONG_TICK_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [isPlaying, isFocused, isBookMismatch, syncIndexes]);

  return {
    activeSegmentIndex: indexes.activeSegmentIndex,
    activeWordIndex: indexes.activeWordIndex,
    isBookMismatch,
    getPositionMs,
  };
};
