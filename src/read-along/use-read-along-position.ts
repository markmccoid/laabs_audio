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
 * - A single `setInterval` (150 ms by default; 40 ms for transcript words)
 *   recomputes the interpolated position and both
 *   indexes, and calls `setState` **only when an index actually changes** — so
 *   React re-renders at word-boundary frequency (~2-4/s), not tick frequency.
 * - The interval runs only while playback is `playing`, the screen is focused,
 *   and the playing book is the bound book. Anything else leaves the last
 *   indexes frozen in place (paused) or cleared (mismatch).
 *
 * The plain JS clock resolves word boundaries; visual fades run independently
 * on the UI thread. More frequent sampling does not render unchanged indexes.
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

/** Default cadence for segment / EPUB tracking. */
export const READ_ALONG_TICK_MS = 150;
/** Finer transcript word sampling reduces late transitions at faster playback. */
export const READ_ALONG_WORD_TICK_MS = 40;

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
  /** Transcript words opt into finer sampling; EPUB keeps the default cadence. */
  tickIntervalMs?: number;
  /**
   * Look this many wall-clock milliseconds into the future when resolving the
   * active index. Zero for Transcript Read-Along, which paints instantly.
   *
   * EPUB Read-Along needs it: a Readium decoration takes a measured ~0.4 s to
   * appear (D47), and that cost is deterministic latency rather than jank — so
   * issuing the apply this far early makes the delay invisible instead of merely
   * short. `interpolatePosition` multiplies elapsed wall time by `rate`, so the
   * look-ahead is automatically `leadMs × rate` in book time and stays correct
   * at 2×. While paused it is ignored, because a paused reader should mark where
   * the listener actually is.
   */
  leadMs?: number;
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
  tickIntervalMs = READ_ALONG_TICK_MS,
  leadMs = 0,
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
  const leadMsRef = useRef(leadMs);

  const [indexes, setIndexes] = useState<ActiveIndexes>(NO_ACTIVE_INDEXES);

  // Deliberately without `leadMs`: this reports where the listener *is*, and its
  // callers (tap-to-seek context, one-shot lookups) would all be wrong by a lead
  // if it reported where the highlight is about to be.
  const getPositionMs = useCallback(() => interpolatePosition(anchorRef.current, Date.now()), []);

  /** Recompute both indexes and commit only when one of them changed. */
  const syncIndexes = useCallback(() => {
    const next = mismatchRef.current
      ? NO_ACTIVE_INDEXES
      : (() => {
          const currentMs = interpolatePosition(anchorRef.current, Date.now() + leadMsRef.current);
          const words = wordsRef.current;
          return {
            activeSegmentIndex: findActiveSegmentIndex(segmentsRef.current, currentMs),
            activeWordIndex: words ? findActiveWordIndex(words, currentMs) : NO_ACTIVE_INDEX,
          };
        })();

    setIndexes((previous) => {
      if (
        previous.activeSegmentIndex === next.activeSegmentIndex &&
        previous.activeWordIndex === next.activeWordIndex
      ) {
        return previous;
      }
      // A frozen highlight with the ticker running is either this index not
      // moving or the list not re-rendering when it does. Logging the segment
      // index and the position it was derived from separates the two: a moving
      // `pos` with a stuck `segment` is a lookup problem, and both moving means
      // the problem is downstream in rendering.
      if (previous.activeSegmentIndex !== next.activeSegmentIndex) {
        console.log(
          `[ReadAlong] segment lead=${leadMsRef.current} index=${next.activeSegmentIndex} pos=${Math.round(
            interpolatePosition(anchorRef.current, Date.now() + leadMsRef.current),
          )} of=${segmentsRef.current.length}`,
        );
      }
      return next;
    });
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
    // `interpolatePosition` can never rewind within one anchor (it is clamped to
    // `>= anchor.positionMs`), so a highlight that cycles backwards can only be
    // re-anchoring onto a position that is not advancing. Logging the *delta*
    // between consecutive anchors is what separates "the store is pinned" from
    // "the lookup is wrong": `dPos` near zero with `dt` near a second means the
    // player is re-writing the same position at tick rate and Read-Along is
    // faithfully rendering a stuck clock.
    const previous = anchorRef.current;
    if (
      previous.positionMs !== anchor.positionMs ||
      previous.anchoredAtMs !== anchor.anchoredAtMs ||
      previous.isPlaying !== anchor.isPlaying ||
      previous.rate !== anchor.rate
    ) {
      console.log(
        `[ReadAlong] anchor lead=${leadMs} pos=${Math.round(anchor.positionMs)} dPos=${Math.round(
          anchor.positionMs - previous.positionMs,
        )} dt=${anchor.anchoredAtMs - previous.anchoredAtMs} rate=${anchor.rate} playing=${
          anchor.isPlaying
        } state=${playbackState}`,
      );
    }

    anchorRef.current = anchor;
    segmentsRef.current = segments;
    wordsRef.current = activeSegmentWords;
    mismatchRef.current = isBookMismatch;
    leadMsRef.current = leadMs;
    syncIndexes();
  }, [anchor, segments, activeSegmentWords, isBookMismatch, leadMs, playbackState, syncIndexes]);

  useEffect(() => {
    if (!isPlaying || !isFocused || isBookMismatch) {
      // A frozen highlight while audio advances means this interval is not
      // running, and there are three ways that happens. Naming which one costs
      // one line and is the difference between a diagnosis and a guess — the
      // symptom is identical for all three from the outside.
      console.log(
        `[ReadAlong] ticker idle lead=${leadMs} isPlaying=${isPlaying} isFocused=${isFocused} mismatch=${isBookMismatch}`,
      );
      return;
    }

    console.log(`[ReadAlong] ticker running lead=${leadMs}`);
    const intervalId = setInterval(syncIndexes, tickIntervalMs);
    return () => {
      clearInterval(intervalId);
    };
  }, [isPlaying, isFocused, isBookMismatch, leadMs, syncIndexes, tickIntervalMs]);

  return {
    activeSegmentIndex: indexes.activeSegmentIndex,
    activeWordIndex: indexes.activeWordIndex,
    isBookMismatch,
    getPositionMs,
  };
};
