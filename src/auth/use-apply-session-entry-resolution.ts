import { router } from "expo-router";
import { useCallback } from "react";
import { useActivateLibrarySelection } from "../hooks/use-activate-library-selection";
import type { SessionEntryResolution } from "./enter-user-session";

type ApplyOptions = {
  returnToLibraryItemId?: string;
  onError: (message: string) => void;
  // Called for the "failed" outcome after onError, so a surface can react to the
  // failure kind (e.g. the list/edit screens open the edit form for a sign-in that
  // needs attention, but not when the failure was merely offline).
  onFailed?: (failure: Extract<SessionEntryResolution, { outcome: "failed" }>) => void;
};

/**
 * Maps a Session Entry Resolution (ADR-0020) to navigation. This is the one place that
 * turns enterUserSession outcomes into routes and runs the shared Library Activation, so
 * the deep module itself stays navigation-free and testable.
 */
export const useApplySessionEntryResolution = () => {
  const activateLibrarySelection = useActivateLibrarySelection();

  return useCallback(
    async (resolution: SessionEntryResolution, options: ApplyOptions) => {
      switch (resolution.outcome) {
        case "activate":
          await activateLibrarySelection(resolution.library, {
            mode: "setup",
            returnToLibraryItemId: options.returnToLibraryItemId,
          });
          return;
        case "needsLibrarySelection":
          router.push({
            pathname: "/library-picker",
            params: {
              mode: "setup",
              ...(options.returnToLibraryItemId
                ? { returnToLibraryItemId: options.returnToLibraryItemId }
                : {}),
            },
          });
          return;
        case "noLibraries":
          options.onError(resolution.message);
          return;
        case "failed":
          options.onError(resolution.message);
          options.onFailed?.(resolution);
          return;
      }
    },
    [activateLibrarySelection],
  );
};
