import { mmkvStorage } from "@/store/mmkv-storage";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { SidecarAudioFingerprint, SidecarBookmarkRecord } from "./sidecar-format";
import type { SyncedRecordState } from "./sidecar-record-adapters";

/**
 * Device-side Bookmark Sidecar sync state (ADR 0046). Bookmark content lives in
 * the bookmark stores; this only remembers what was last synced, deletion
 * markers awaiting upload, and per-item sync status.
 */

export type CompanionStatus = "unknown" | "available" | "unavailable";

export type CompanionEndpointState = {
  /** User-entered LAABS Companion URL; null means try the conventional `<server>/laabs`. */
  manualUrl: string | null;
  resolvedUrl: string | null;
  status: CompanionStatus;
  checkedAt: number | null;
};

export type SyncedEntry = SyncedRecordState & {
  libraryItemId: string;
  media: "book" | "episode";
};

export type DeletionMarker = SidecarBookmarkRecord & { libraryItemId: string };

/**
 * A sync scope is a book (`libraryItemId`) or one Episode of a Podcast
 * (`libraryItemId::episodeId`): Audio Fingerprints are checked per scope.
 */
export type ScopeSyncState = {
  status: "mismatch" | "paused";
  storedFingerprint: SidecarAudioFingerprint | null;
  currentFingerprint: SidecarAudioFingerprint | null;
  remoteRecordCount: number;
  localRecordCount: number;
};

type PersistedState = {
  companionBySession: Record<string, CompanionEndpointState>;
  syncedByUser: Record<string, Record<string, SyncedEntry>>;
  deletionMarkersByUser: Record<string, Record<string, DeletionMarker>>;
  dirtyItemsByUser: Record<string, Record<string, number>>;
  scopeStateByUser: Record<string, Record<string, ScopeSyncState>>;
  backfilledByUser: Record<string, boolean>;
};

type BookmarkSidecarState = PersistedState & {
  lastErrorByUserItem: Record<string, string>;
  /** Titles seen while syncing, for items the active library's catalog doesn't know. */
  itemTitleByUserItem: Record<string, string>;
};

export const EMPTY_COMPANION_ENDPOINT: CompanionEndpointState = {
  manualUrl: null,
  resolvedUrl: null,
  status: "unknown",
  checkedAt: null,
};

export const sidecarScopeKey = (libraryItemId: string, episodeId?: string | null) =>
  episodeId ? `${libraryItemId}::${episodeId}` : libraryItemId;

const createDefaultState = (): BookmarkSidecarState => ({
  companionBySession: {},
  syncedByUser: {},
  deletionMarkersByUser: {},
  dirtyItemsByUser: {},
  scopeStateByUser: {},
  backfilledByUser: {},
  lastErrorByUserItem: {},
  itemTitleByUserItem: {},
});

export const sidecarUserItemKey = (userKey: string, libraryItemId: string) =>
  `${userKey}::${libraryItemId}`;

export const bookmarkSidecarStore = createStore<BookmarkSidecarState>()(
  persist(() => createDefaultState(), {
    name: "bookmark-sidecar-sync",
    storage: createJSONStorage(() => mmkvStorage),
    version: 1,
    partialize: ({ lastErrorByUserItem: _errors, itemTitleByUserItem: _titles, ...persisted }) =>
      persisted,
    merge: (persisted, current) => ({ ...current, ...(persisted as Partial<PersistedState>) }),
  }),
);

export const useBookmarkSidecarStore = <T,>(selector: (state: BookmarkSidecarState) => T) =>
  useStore(bookmarkSidecarStore, selector);

const setForUser = <K extends keyof PersistedState>(
  key: K,
  userKey: string,
  update: (current: PersistedState[K][string]) => PersistedState[K][string],
) => {
  bookmarkSidecarStore.setState((state) => ({
    [key]: {
      ...state[key],
      [userKey]: update(state[key][userKey] as PersistedState[K][string]),
    },
  }) as Partial<BookmarkSidecarState>);
};

export const sidecarStateActions = {
  setCompanion(sessionKey: string, values: Partial<CompanionEndpointState>) {
    bookmarkSidecarStore.setState((state) => ({
      companionBySession: {
        ...state.companionBySession,
        [sessionKey]: {
          ...(state.companionBySession[sessionKey] ?? EMPTY_COMPANION_ENDPOINT),
          ...values,
        },
      },
    }));
  },

  markDirty(userKey: string, libraryItemIds: Iterable<string>) {
    const ids = [...libraryItemIds];
    if (!ids.length) return;
    const now = Date.now();
    setForUser("dirtyItemsByUser", userKey, (current) => {
      const next = { ...(current ?? {}) };
      ids.forEach((id) => {
        next[id] = next[id] ?? now;
      });
      return next;
    });
  },

  clearDirty(userKey: string, libraryItemId: string, ifMarkedBefore: number) {
    setForUser("dirtyItemsByUser", userKey, (current) => {
      const markedAt = current?.[libraryItemId];
      // A change made while this item was syncing keeps it dirty for the next flush.
      if (markedAt === undefined || markedAt > ifMarkedBefore) return current ?? {};
      const { [libraryItemId]: _cleared, ...rest } = current ?? {};
      return rest;
    });
  },

  setSynced(userKey: string, entries: Record<string, SyncedEntry>, removedIds: Iterable<string>) {
    setForUser("syncedByUser", userKey, (current) => {
      const next = { ...(current ?? {}), ...entries };
      for (const id of removedIds) delete next[id];
      return next;
    });
  },

  addDeletionMarker(userKey: string, marker: DeletionMarker) {
    setForUser("deletionMarkersByUser", userKey, (current) => ({
      ...(current ?? {}),
      [marker.id]: marker,
    }));
  },

  removeDeletionMarkers(userKey: string, ids: Iterable<string>) {
    setForUser("deletionMarkersByUser", userKey, (current) => {
      const next = { ...(current ?? {}) };
      for (const id of ids) delete next[id];
      return next;
    });
  },

  /**
   * A user deleted a bookmark in LAABS Audio. Only records a Bookmark Sidecar
   * has seen need a deletion marker; the rest never left the device.
   */
  noteDeleted(userKey: string, recordId: string) {
    const entry = bookmarkSidecarStore.getState().syncedByUser[userKey]?.[recordId];
    if (!entry) return;
    const now = Date.now();
    sidecarStateActions.addDeletionMarker(userKey, {
      id: recordId,
      libraryItemId: entry.libraryItemId,
      kind: "point",
      startTimeSeconds: 0,
      title: "",
      note: null,
      createdAt: 0,
      updatedAt: now,
      deletedAt: now,
    });
    sidecarStateActions.markDirty(userKey, [entry.libraryItemId]);
  },

  setScopeState(userKey: string, scopeKey: string, value: ScopeSyncState | null) {
    setForUser("scopeStateByUser", userKey, (current) => {
      const next = { ...(current ?? {}) };
      if (value) next[scopeKey] = value;
      else delete next[scopeKey];
      return next;
    });
  },

  setBackfilled(userKey: string, value: boolean) {
    bookmarkSidecarStore.setState((state) => ({
      backfilledByUser: { ...state.backfilledByUser, [userKey]: value },
    }));
  },

  setLastError(userKey: string, libraryItemId: string, message: string | null) {
    bookmarkSidecarStore.setState((state) => {
      const key = sidecarUserItemKey(userKey, libraryItemId);
      const next = { ...state.lastErrorByUserItem };
      if (message) next[key] = message;
      else delete next[key];
      return { lastErrorByUserItem: next };
    });
  },

  setItemTitle(userKey: string, libraryItemId: string, title: string | null | undefined) {
    const trimmed = title?.trim();
    if (!trimmed) return;
    const key = sidecarUserItemKey(userKey, libraryItemId);
    if (bookmarkSidecarStore.getState().itemTitleByUserItem[key] === trimmed) return;
    bookmarkSidecarStore.setState((state) => ({
      itemTitleByUserItem: { ...state.itemTitleByUserItem, [key]: trimmed },
    }));
  },
};
