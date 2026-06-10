import { activateLibrary } from "@/auth/library-activation";
import { libraryActivationStore } from "@/auth/library-activation-store";
import { authStore, useAuthStore } from "@/auth/auth-store";
import { queryClient } from "@/query/query-client";
import { recordTimingLog } from "@/data/sqlite/timing-logger";
import { getBookDetailHref } from "@/navigation/book-links";
import { playerService } from "@/player/player-service";
import type { Library } from "@/types/absTypes";
import { router } from "expo-router";
import { useCallback } from "react";

type ActivateLibrarySelectionOptions = {
  mode?: "default" | "setup";
  returnToLibraryItemId?: string | null;
};

const didCatalogIncludeItem = (
  catalog: Awaited<ReturnType<typeof activateLibrary>>["catalog"],
  libraryItemId: string | null | undefined,
) => Boolean(libraryItemId && catalog.some((item) => item.id === libraryItemId));

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export const runLibraryActivationSelection = async (
  library: Library,
  options: ActivateLibrarySelectionOptions = {},
) => {
  const activationState = libraryActivationStore.getState();
  const authState = authStore.getState();

  if (activationState.status === "activating") return;
  if (library.id === authState.activeLibraryId) {
    router.replace("/(tabs)/(home)");
    return;
  }

  const startedAt = Date.now();
  activationState.actions.start(library);
  router.replace("/(tabs)/(home)");
  await waitForNextFrame();

  try {
    const result = await activateLibrary({
      library,
      activeLibraryUserKey: authState.activeLibraryUserKey,
      queryClient,
    });

    await playerService.endActivePlaybackForLibrarySwitch();
    authState.actions.setActiveLibrary({ id: library.id, name: library.name });

    const returnToLibraryItemId = options.returnToLibraryItemId;
    if (
      options.mode === "setup" &&
      returnToLibraryItemId &&
      didCatalogIncludeItem(result.catalog, returnToLibraryItemId)
    ) {
      router.replace(getBookDetailHref(returnToLibraryItemId));
      await waitForNextFrame();
      activationState.actions.clear();
      void recordTimingLog("library_switch", "activation_selection", startedAt, {
        libraryId: library.id,
        libraryName: library.name,
        mode: options.mode,
        returnToLibraryItemId,
        success: true,
      });
      return;
    }

    await waitForNextFrame();
    activationState.actions.clear();
    void recordTimingLog("library_switch", "activation_selection", startedAt, {
      libraryId: library.id,
      libraryName: library.name,
      mode: options.mode,
      success: true,
    });
  } catch (error) {
    activationState.actions.fail(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    void recordTimingLog("library_switch", "activation_selection", startedAt, {
      libraryId: library.id,
      libraryName: library.name,
      mode: options.mode,
      success: false,
      error: errorMessage,
    });
  }
};

export const useActivateLibrarySelection = () => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activateSelection = useCallback(
    async (library: Library, options: ActivateLibrarySelectionOptions = {}) => {
      if (library.id === activeLibraryId) {
        router.replace("/(tabs)/(home)");
        return;
      }
      await runLibraryActivationSelection(library, options);
    },
    [activeLibraryId],
  );

  return activateSelection;
};
