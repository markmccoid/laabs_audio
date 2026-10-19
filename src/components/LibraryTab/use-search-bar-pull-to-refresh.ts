import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { runAfterInteractions } from "@/utils/run-after-interactions";

const SPURIOUS_REFRESH_WINDOW_MS = 400;

/**
 * Pull-to-refresh for a list under the navigation search bar.
 *
 * On iOS 26, mounting UIRefreshControl before that bar's content inset exists
 * looks like a pull already in progress, so the spinner is drawn inside the
 * search field and stays there until the next scroll. Attach the control
 * after the screen is focused, and only show the spinner for a user pull.
 */

export const useSearchBarPullToRefresh = (refetch: () => unknown) => {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const attachedAtRef = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAttached, setIsAttached] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let frame = 0;
      let cancelled = false;
      const task = runAfterInteractions(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled) return;
          attachedAtRef.current = Date.now();
          setIsAttached(true);
        });
      });
      return () => {
        cancelled = true;
        task.cancel();
        if (frame) cancelAnimationFrame(frame);
      };
    }, []),
  );

  const onRefresh = useCallback(() => {
    // iOS 26 can start UIRefreshControl on its own when the control is first
    // attached under a search bar. That is not a user pull; end it immediately
    // so the search field does not keep the spinner.
    if (Date.now() - attachedAtRef.current < SPURIOUS_REFRESH_WINDOW_MS) {
      setIsRefreshing(true);
      requestAnimationFrame(() => setIsRefreshing(false));
      return;
    }

    setIsRefreshing(true);
    void Promise.resolve(refetchRef.current()).finally(() => {
      setIsRefreshing(false);
    });
  }, []);

  if (!isAttached) {
    return { refreshing: false, onRefresh: undefined };
  }

  return { refreshing: isRefreshing, onRefresh };
};
