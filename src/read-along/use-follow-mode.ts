/**
 * Follow Mode controller (`docs/read-along-implementation-plan.md` Phase 2).
 *
 * Keeps the active list row parked at the reader's chosen viewport position
 * while enabled, backs off the moment the reader scrolls by hand, and
 * re-engages only on an explicit "Resume following" tap (no auto-resume timer —
 * settled decision).
 *
 * The hook is deliberately dumb about transcript shapes: it takes a
 * **list-space** index (the caller applies its own header / pending-block
 * offsets) and any ref exposing `scrollToIndex`.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ReadAlongFollowAlignment } from "./read-along-follow-alignment";
import { getFollowViewPosition } from "./read-along-follow-alignment";

/** At most one programmatic scroll per this window. */
const SCROLL_THROTTLE_MS = 500;
/**
 * How long after a programmatic scroll we ignore drag callbacks. FlashList and
 * ScrollView only fire `onScrollBeginDrag` for touch scrolls, so this window is
 * belt-and-braces against a platform that ever fires it for animated scrolls.
 */
const PROGRAMMATIC_SCROLL_WINDOW_MS = 600;
/** Minimal structural shape — `FlashListRef<T>` and `ScrollView` refs satisfy it. */
export type FollowModeScrollTarget = {
  scrollToIndex: (params: {
    index: number;
    animated?: boolean;
    viewPosition?: number;
  }) => void;
};

export type UseFollowModeArgs = {
  listRef: RefObject<FollowModeScrollTarget | null>;
  /**
   * Index of the active row **in list space** (header rows, section headers and
   * pending blocks already accounted for by the caller), or a negative value
   * when nothing is active.
   */
  activeListIndex: number;
  /** Where the active row sits inside the readable transcript viewport. */
  alignment: ReadAlongFollowAlignment;
};

export type UseFollowModeResult = {
  followEnabled: boolean;
  /** Re-enable Follow Mode and jump to the active row right away. */
  resumeFollowing: () => void;
  /** Wire to the list's `onScrollBeginDrag`. */
  handleScrollBeginDrag: () => void;
  /**
   * Pause Follow Mode without a scroll gesture, for anything that needs the page
   * to hold still — a Clip Selection does (ADR 0035). Resuming stays explicit,
   * exactly as it is after a manual scroll.
   */
  suspendFollowing: () => void;
};

export const useFollowMode = ({
  listRef,
  activeListIndex,
  alignment,
}: UseFollowModeArgs): UseFollowModeResult => {
  const [followEnabled, setFollowEnabled] = useState(true);
  const viewPosition = getFollowViewPosition(alignment);

  // Latest active index for `resumeFollowing`, written in an effect (never
  // during render) so the callback can stay a stable identity.
  const activeListIndexRef = useRef(activeListIndex);
  useEffect(() => {
    activeListIndexRef.current = activeListIndex;
  }, [activeListIndex]);

  const lastScrollAtMsRef = useRef(0);
  const lastScrollRef = useRef<{ index: number; viewPosition: number } | null>(null);
  const programmaticScrollUntilMsRef = useRef(0);

  const scrollToIndex = useCallback(
    (index: number) => {
      if (index < 0) return;
      const nowMs = Date.now();
      lastScrollAtMsRef.current = nowMs;
      lastScrollRef.current = { index, viewPosition };
      programmaticScrollUntilMsRef.current = nowMs + PROGRAMMATIC_SCROLL_WINDOW_MS;
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition,
      });
    },
    [listRef, viewPosition],
  );

  // Follow the active row, at most once per throttle window. Because this effect
  // re-runs on every index change, a deferred scroll always lands on the latest
  // index rather than a stale one.
  useEffect(() => {
    if (!followEnabled) return;
    if (activeListIndex < 0) return;
    const lastScroll = lastScrollRef.current;
    if (lastScroll?.index === activeListIndex && lastScroll.viewPosition === viewPosition) return;

    // A setting change should preview immediately even when the active sentence
    // has not changed and the ordinary follow throttle is still running.
    if (lastScroll && lastScroll.viewPosition !== viewPosition) {
      scrollToIndex(activeListIndex);
      return;
    }

    const elapsedMs = Date.now() - lastScrollAtMsRef.current;
    if (elapsedMs >= SCROLL_THROTTLE_MS) {
      scrollToIndex(activeListIndex);
      return;
    }

    const timeoutId = setTimeout(() => {
      scrollToIndex(activeListIndex);
    }, SCROLL_THROTTLE_MS - elapsedMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [activeListIndex, followEnabled, scrollToIndex, viewPosition]);

  const handleScrollBeginDrag = useCallback(() => {
    if (Date.now() < programmaticScrollUntilMsRef.current) return;
    setFollowEnabled(false);
  }, []);

  const resumeFollowing = useCallback(() => {
    setFollowEnabled(true);
    scrollToIndex(activeListIndexRef.current);
  }, [scrollToIndex]);

  const suspendFollowing = useCallback(() => {
    setFollowEnabled(false);
  }, []);

  return { followEnabled, resumeFollowing, handleScrollBeginDrag, suspendFollowing };
};
