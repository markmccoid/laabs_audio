import { router } from "expo-router";
import { fetchLibrariesForResolution, resolveLibrarySelection } from "./library-resolution";
import { useAuthActions } from "./auth-store";
import { useActivateLibrarySelection } from "../hooks/use-activate-library-selection";

export const useCompleteSessionEntry = () => {
  const { setLoginRequired } = useAuthActions();
  const activateLibrarySelection = useActivateLibrarySelection();

  return async (options?: {
    mode?: string;
    returnToLibraryItemId?: string;
    activeLibraryId?: string | null;
  }) => {
    const response = await fetchLibrariesForResolution();
    const resolution = resolveLibrarySelection(response.libraries, options?.activeLibraryId);

    if (resolution.status === "noLibraries") {
      throw new Error("This Audiobookshelf user does not have any libraries available.");
    }

    if (resolution.status === "needsLibrarySelection") {
      router.push({
        pathname: "/library-picker",
        params: {
          mode: "setup",
          ...(options?.returnToLibraryItemId
            ? { returnToLibraryItemId: options.returnToLibraryItemId }
            : null),
        },
      });
      return;
    }

    if (options?.mode === "sheet") {
      setLoginRequired(false);
    }

    await activateLibrarySelection(resolution.library, {
      mode: "setup",
      returnToLibraryItemId: options?.returnToLibraryItemId,
    });
  };
};
