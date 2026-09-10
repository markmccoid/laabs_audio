/**
 * Read-Along highlight hook (`docs/read-along-implementation-plan.md` Phase 3.2).
 *
 * Wraps `useReadAlongPosition` with the lazy word-timing fetch it deliberately
 * does not own, and hands the screen one flat answer:
 * "which segment, which word, and the word timings that word index refers to".
 *
 * Why the two are joined here rather than in the screen: the position hook
 * needs the active segment's word timings as an *input*, but which segment is
 * active is its *output*. Resolving that cycle takes a render of latency —
 * fetch the words for the segment that just became active, feed them in on the
 * next render — and it is contained entirely inside this hook. Word timings are
 * book-absolute, so during that one render the stale timings simply resolve to
 * "no active word" (never to a wrong word).
 *
 * Only ~5 segments' timings are kept: an LRU big enough that scrubbing back a
 * sentence or two is instant, small enough that a 150k-word book never has more
 * than a handful of parsed arrays alive.
 */

import {
  getSegmentWords,
  type TranscriptSegmentTextRow,
  type TranscriptSegmentWordTiming,
} from "@/data/sqlite/shadow-db-transcripts";
import { useCallback, useEffect, useRef, useState } from "react";
import { NO_ACTIVE_INDEX } from "./read-along-sync";
import { READ_ALONG_WORD_TICK_MS, useReadAlongPosition } from "./use-read-along-position";

/** How many segments' parsed word timings stay in memory. */
export const READ_ALONG_WORDS_CACHE_SIZE = 5;

type WordsEntry = {
  segmentId: number;
  timings: TranscriptSegmentWordTiming[] | null;
};

export type UseReadAlongHighlightArgs = {
  boundLibraryItemId: string | null;
  /** The rendered segments, in reading order (`ReadAlongListModel.readableSegments`). */
  segments: readonly TranscriptSegmentTextRow[];
  /**
   * False when the reader's highlight style is `none`. Word timings are then
   * never fetched and no word index is resolved, so a long book ticks at
   * segment rate — roughly one render per sentence instead of 2-4 a second.
   *
   * Switching back to a word style fetches the current segment's timings and
   * resumes at the current listening position.
   */
  isWordHighlightEnabled: boolean;
};

export type UseReadAlongHighlightResult = {
  activeSegmentIndex: number;
  activeWordIndex: number;
  /** The active segment's row, or null when nothing is highlighted. */
  activeSegment: TranscriptSegmentTextRow | null;
  /**
   * Word timings **for the active segment only**, or null when it has none /
   * they are still loading. Never timings belonging to another segment.
   */
  activeSegmentWords: TranscriptSegmentWordTiming[] | null;
  isBookMismatch: boolean;
  getPositionMs: () => number;
};

export const useReadAlongHighlight = ({
  boundLibraryItemId,
  segments,
  isWordHighlightEnabled,
}: UseReadAlongHighlightArgs): UseReadAlongHighlightResult => {
  const [wordsEntry, setWordsEntry] = useState<WordsEntry | null>(null);

  const { activeSegmentIndex, activeWordIndex, isBookMismatch, getPositionMs } =
    useReadAlongPosition({
      boundLibraryItemId,
      segments,
      tickIntervalMs: isWordHighlightEnabled ? READ_ALONG_WORD_TICK_MS : undefined,
      // Withholding the timings is what makes `none` cheap: the position hook
      // then resolves no word index at all, so it stops re-rendering at word
      // rate instead of resolving an index nothing displays.
      activeSegmentWords: isWordHighlightEnabled ? (wordsEntry?.timings ?? null) : null,
    });

  const activeSegment =
    activeSegmentIndex >= 0 ? (segments[activeSegmentIndex] ?? null) : null;
  const activeSegmentId = activeSegment?.id ?? null;

  const cacheRef = useRef(new Map<number, TranscriptSegmentWordTiming[] | null>());

  // Segment ids are database row ids, unique per book — but a rebind to another
  // book replaces every row, so drop the cache with the binding rather than
  // risk holding another book's timings.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      cache.clear();
    };
  }, [boundLibraryItemId]);

  /**
   * Always a promise, cache hit or miss: resolving through a microtask keeps the
   * `setWordsEntry` out of the effect body (no synchronous state write during an
   * effect) while still landing before the next paint on a hit.
   */
  const readWords = useCallback(
    async (segmentId: number): Promise<TranscriptSegmentWordTiming[] | null> => {
      const cache = cacheRef.current;
      if (cache.has(segmentId)) {
        const cached = cache.get(segmentId) ?? null;
        // Refresh recency.
        cache.delete(segmentId);
        cache.set(segmentId, cached);
        return cached;
      }

      const timings = await getSegmentWords(segmentId).catch(() => null);
      cache.set(segmentId, timings);
      while (cache.size > READ_ALONG_WORDS_CACHE_SIZE) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return timings;
    },
    [],
  );

  useEffect(() => {
    if (!isWordHighlightEnabled) return;
    if (activeSegmentId === null) {
      // Keep the last entry: it stays keyed to its own segment, so it can never
      // be mistaken for another one, and re-entering that segment is instant.
      return;
    }

    let isCancelled = false;
    void readWords(activeSegmentId).then((timings) => {
      if (isCancelled) return;
      setWordsEntry((previous) =>
        previous?.segmentId === activeSegmentId && previous.timings === timings
          ? previous
          : { segmentId: activeSegmentId, timings },
      );
    });

    return () => {
      isCancelled = true;
    };
  }, [activeSegmentId, isWordHighlightEnabled, readWords]);

  const wordsForActiveSegment =
    isWordHighlightEnabled && activeSegmentId !== null && wordsEntry?.segmentId === activeSegmentId
      ? wordsEntry.timings
      : null;

  return {
    activeSegmentIndex,
    // The position hook resolved this index against whatever timings it was
    // handed; suppress it while those belong to a different segment.
    activeWordIndex: wordsForActiveSegment ? activeWordIndex : NO_ACTIVE_INDEX,
    activeSegment,
    activeSegmentWords: wordsForActiveSegment,
    isBookMismatch,
    getPositionMs,
  };
};
