import {
  deviceBooksStore,
  selectDownloadOwnerUserId,
  useDeviceBooksStore,
} from "../store/device-books-store";
import { authStore, useAuthStore } from "./auth-store";

/**
 * Resolves the Audiobookshelf User Identity that owns local listening state — Bookmarks,
 * Progress Sync Intents, Listening Position, Playback Rate — for an audiobook:
 *   1. the signed-in / remembered User Session identity, when present, else
 *   2. the Downloaded Audio Asset Owner for that item (used in Downloaded-Only Mode).
 *
 * This is the single home for the `activeLibraryUserKey ?? storedUserId ?? downloadOwner`
 * chain that was previously recomputed at every bookmark/player surface. See CONTEXT.md
 * (Downloaded Audio Asset Owner) and ADR-0015.
 */
export const resolveListeningOwnerKey = (libraryItemId?: string | null): string | null => {
  const auth = authStore.getState();
  return (
    auth.activeLibraryUserKey ??
    auth.storedUserId ??
    selectDownloadOwnerUserId(deviceBooksStore.getState(), libraryItemId)
  );
};

/** Reactive hook form of {@link resolveListeningOwnerKey} for React components. */
export const useResolvedListeningOwnerKey = (libraryItemId?: string | null): string | null => {
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUserId = useAuthStore((state) => state.storedUserId);
  const downloadOwnerUserId = useDeviceBooksStore((state) =>
    selectDownloadOwnerUserId(state, libraryItemId),
  );
  return activeLibraryUserKey ?? storedUserId ?? downloadOwnerUserId;
};
