import { activateLibrary } from "@/auth/library-activation";
import { libraryActivationStore } from "@/auth/library-activation-store";
import { authStore, type AuthState } from "@/auth/auth-store";
import { queryClient } from "@/query/query-client";
import { sqliteSearchRepository } from "@/data/sqlite/search-repository";
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

const normalizedMediaType = (value: string | null | undefined) =>
  value?.trim().toLowerCase() || null;

export const canReuseActiveLibrary = (
  library: Library,
  activeLibrary: Pick<
    AuthState,
    "activeLibraryId" | "activeLibraryMediaType" | "activeLibraryReady"
  >,
) =>
  library.id === activeLibrary.activeLibraryId &&
  activeLibrary.activeLibraryReady &&
  normalizedMediaType(library.mediaType) ===
    normalizedMediaType(activeLibrary.activeLibraryMediaType);

// Requires the target library to already be active (auth store) so the
// SQLite lookup is scoped to the right catalog.
const isItemInActiveCatalog = async (libraryItemId: string | null | undefined) => {
  if (!libraryItemId) return false;
  try {
    const summaries = await sqliteSearchRepository.getItemSummariesByIds([libraryItemId]);
    return summaries.has(libraryItemId);
  } catch {
    return false;
  }
};

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
  if (canReuseActiveLibrary(library, authState)) {
    router.replace("/(tabs)/(home)");
    return;
  }

  const startedAt = Date.now();
  activationState.actions.start(library);
  router.replace("/(tabs)/(home)");
  await waitForNextFrame();

  try {
    await activateLibrary({
      library,
      activeLibraryUserKey: authState.activeLibraryUserKey,
      queryClient,
    });

    await playerService.endActivePlaybackForLibrarySwitch();
    authState.actions.setActiveLibrary({
      id: library.id,
      name: library.name,
      mediaType: library.mediaType,
    });

    const returnToLibraryItemId = options.returnToLibraryItemId;
    if (
      options.mode === "setup" &&
      returnToLibraryItemId &&
      (await isItemInActiveCatalog(returnToLibraryItemId))
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
  const activateSelection = useCallback(
    async (library: Library, options: ActivateLibrarySelectionOptions = {}) => {
      await runLibraryActivationSelection(library, options);
    },
    [],
  );

  return activateSelection;
};
