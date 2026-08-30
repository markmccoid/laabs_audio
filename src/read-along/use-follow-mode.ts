/**
 * Follow Mode controller (`docs/read-along-implementation-plan.md` Phase 2).
 *
 * Keeps the active list row parked ~40% down the viewport while enabled, backs
 * off the moment the reader scrolls by hand, and re-engages only on an explicit
 * "Resume following" tap (no auto-resume timer — settled decision).
 *
 * The hook is deliberately dumb about transcript shapes: it takes a
 * **list-space** index (the caller applies its own header / pending-block
 * offsets) and any ref exposing `scrollToIndex`.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** At most one programmatic scroll per this window. */
const SCROLL_THROTTLE_MS = 500;
/**
 * How long after a programmatic scroll we ignore drag callbacks. FlashList and
 * ScrollView only fire `onScrollBeginDrag` for touch scrolls, so this window is
 * belt-and-braces against a platform that ever fires it for animated scrolls.
 */
const PROGRAMMATIC_SCROLL_WINDOW_MS = 600;
/** Active row sits ~40% from the top of the viewport. */
const FOLLOW_VIEW_POSITION = 0.4;

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
};

export type UseFollowModeResult = {
  followEnabled: boolean;
  /** Re-enable Follow Mode and jump to the active row right away. */
  resumeFollowing: () => void;
  /** Wire to the list's `onScrollBeginDrag`. */
  handleScrollBeginDrag: () => void;
};

export const useFollowMode = ({
  listRef,
  activeListIndex,
}: UseFollowModeArgs): UseFollowModeResult => {
  const [followEnabled, setFollowEnabled] = useState(true);

  // Latest active index for `resumeFollowing`, written in an effect (never
  // during render) so the callback can stay a stable identity.
  const activeListIndexRef = useRef(activeListIndex);
  useEffect(() => {
    activeListIndexRef.current = activeListIndex;
  }, [activeListIndex]);

  const lastScrollAtMsRef = useRef(0);
  const lastScrolledIndexRef = useRef(-1);
  const programmaticScrollUntilMsRef = useRef(0);

  const scrollToIndex = useCallback(
    (index: number) => {
      if (index < 0) return;
      const nowMs = Date.now();
      lastScrollAtMsRef.current = nowMs;
      lastScrolledIndexRef.current = index;
      programmaticScrollUntilMsRef.current = nowMs + PROGRAMMATIC_SCROLL_WINDOW_MS;
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: FOLLOW_VIEW_POSITION,
      });
    },
    [listRef],
  );

  // Follow the active row, at most once per throttle window. Because this effect
  // re-runs on every index change, a deferred scroll always lands on the latest
  // index rather than a stale one.
  useEffect(() => {
    if (!followEnabled) return;
    if (activeListIndex < 0) return;
    if (lastScrolledIndexRef.current === activeListIndex) return;

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
  }, [activeListIndex, followEnabled, scrollToIndex]);

  const handleScrollBeginDrag = useCallback(() => {
    if (Date.now() < programmaticScrollUntilMsRef.current) return;
    setFollowEnabled(false);
  }, []);

  const resumeFollowing = useCallback(() => {
    setFollowEnabled(true);
    scrollToIndex(activeListIndexRef.current);
  }, [scrollToIndex]);

  return { followEnabled, resumeFollowing, handleScrollBeginDrag };
};
