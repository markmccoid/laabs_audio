import { useAuthStore } from "@/auth/auth-store";
import { useEffect } from "react";
import { sidecarScopeKey, useBookmarkSidecarStore } from "./bookmark-sidecar-store";
import {
  loadSidecarAnyway,
  pauseSidecarScope,
  replaceServerBookmarks,
  syncBookmarkSidecar,
} from "./sidecar-sync";

/**
 * Pulls an item's Bookmark Sidecar when its Bookmark List opens and exposes
 * the Audio Fingerprint mismatch state for one sync scope (ADR 0046).
 */
export const useBookmarkSidecarScope = (
  libraryItemId: string | null | undefined,
  episodeId?: string | null,
) => {
  const userKey = useAuthStore((state) => state.storedUserId?.trim() || null);
  const scope = libraryItemId ? sidecarScopeKey(libraryItemId, episodeId) : null;
  const scopeState = useBookmarkSidecarStore((state) =>
    userKey && scope ? (state.scopeStateByUser[userKey]?.[scope] ?? null) : null,
  );

  useEffect(() => {
    if (libraryItemId) void syncBookmarkSidecar(libraryItemId);
  }, [libraryItemId, episodeId]);

  return {
    scopeState,
    loadAnyway: () =>
      libraryItemId && scope ? loadSidecarAnyway(libraryItemId, scope) : Promise.resolve(null),
    notNow: () => {
      if (scope) pauseSidecarScope(scope);
    },
    replaceServer: () =>
      libraryItemId && scope ? replaceServerBookmarks(libraryItemId, scope) : Promise.resolve(null),
  };
};
