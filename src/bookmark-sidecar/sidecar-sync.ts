import { AbsApiError, absClient } from "@/api/abs-client";
import { authStore } from "@/auth/auth-store";
import { episodeBookmarksStore, type EpisodeBookmarkRecord } from "@/podcast/episode-bookmarks-store";
import { isImportedAudiobookId } from "@/imported/imported-audiobook-identity";
import { playbackStore } from "@/player/playback-store";
import { deviceBooksStore, type LocalBookmarkRecord } from "@/store/device-books-store";
import type { LibraryItem } from "@/types/absTypes";
import { AppState } from "react-native";
import {
  audioFingerprintsMatch,
  bookAudioFingerprint,
  currentEpisode,
  episodeDurationsMatch,
  sameAudioFingerprint,
  sidecarItemInfo,
  type CurrentEpisode,
} from "./audio-fingerprint";
import {
  bookmarkSidecarStore,
  EMPTY_COMPANION_ENDPOINT,
  sidecarScopeKey,
  sidecarStateActions,
  type ScopeSyncState,
  type SyncedEntry,
} from "./bookmark-sidecar-store";
import { companionClient, conventionalCompanionUrl } from "./companion-client";
import {
  episodeFingerprintKey,
  isSidecarSchemaWritable,
  type BookmarkSidecarDocument,
  type SidecarAudioFingerprint,
  type SidecarBookmarkRecord,
} from "./sidecar-format";
import { areSidecarRecordListsEqual, mergeSidecarRecords, recordContentHash } from "./sidecar-merge";
import {
  bookRecordToSidecar,
  episodeRecordToSidecar,
  resolveSidecarEpisodeId,
  sidecarToBookRecord,
  sidecarToEpisodeRecord,
} from "./sidecar-record-adapters";

/**
 * Bookmark Sidecar sync engine (ADR 0046, BookmarkSidecarImplementationPlan.md §3).
 * Local bookmark stores stay the device's source of truth; a Bookmark Sidecar is
 * a second reconciled input. Everything here is a no-op without a LAABS Companion.
 */

const COMPANION_RECHECK_MS = 60 * 60 * 1000;
const FLUSH_DEBOUNCE_MS = 2_000;

type ActiveContext = { userKey: string; sessionKey: string; serverUrl: string };

export type SidecarSyncResult =
  | "synced"
  | "blocked"
  | "unavailable"
  | "unsupported"
  | "readOnly"
  | "error";

export type SidecarSyncOptions = {
  /** Scopes whose Audio Fingerprint mismatch the user accepted with Load anyway. */
  acceptScopes?: string[];
  /** Replace server bookmarks for `acceptScopes` with this device's (second confirmation already given). */
  replace?: boolean;
};

const getActiveContext = (): ActiveContext | null => {
  const auth = authStore.getState();
  const userKey = auth.storedUserId?.trim();
  if (auth.status !== "authenticated" || auth.isOnline === false) return null;
  if (!userKey || !auth.activeSessionKey || !auth.serverUrl) return null;
  return { userKey, sessionKey: auth.activeSessionKey, serverUrl: auth.serverUrl };
};

// ---------------------------------------------------------------------------
// LAABS Companion discovery

const companionChecks = new Map<string, Promise<string | null>>();

export const resolveCompanion = async (options?: { force?: boolean }): Promise<string | null> => {
  const context = getActiveContext();
  if (!context) return null;
  const endpoint =
    bookmarkSidecarStore.getState().companionBySession[context.sessionKey] ??
    EMPTY_COMPANION_ENDPOINT;
  const isFresh =
    endpoint.checkedAt !== null && Date.now() - endpoint.checkedAt < COMPANION_RECHECK_MS;
  if (!options?.force && isFresh) {
    return endpoint.status === "available" ? endpoint.resolvedUrl : null;
  }

  const inFlight = companionChecks.get(context.sessionKey);
  if (inFlight) return inFlight;

  const check = (async () => {
    const candidate = endpoint.manualUrl ?? conventionalCompanionUrl(context.serverUrl);
    const health = await companionClient.health(candidate);
    sidecarStateActions.setCompanion(context.sessionKey, {
      resolvedUrl: health ? candidate : null,
      status: health ? "available" : "unavailable",
      checkedAt: Date.now(),
    });
    if (health && !bookmarkSidecarStore.getState().backfilledByUser[context.userKey]) {
      backfillUser(context.userKey);
    }
    return health ? candidate : null;
  })().finally(() => companionChecks.delete(context.sessionKey));

  companionChecks.set(context.sessionKey, check);
  return check;
};

export const setManualCompanionUrl = async (url: string | null) => {
  const context = getActiveContext();
  const sessionKey = context?.sessionKey ?? authStore.getState().activeSessionKey;
  if (!sessionKey) return null;
  sidecarStateActions.setCompanion(sessionKey, {
    manualUrl: url?.trim() || null,
    checkedAt: null,
  });
  return resolveCompanion({ force: true });
};

/**
 * Initial upload (and "Sync all bookmarks now"): mark every item with bookmarks
 * dirty. Dirty flags persist, so an interrupted backfill resumes on next flush.
 */
export const backfillUser = (userKey: string) => {
  const bookItemIds = Object.values(
    deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {},
  ).map((record) => record.libraryItemId);
  const podcastItemIds = Object.values(
    episodeBookmarksStore.getState().recordsByUser[userKey] ?? {},
  ).map((record) => record.identity.libraryItemId);
  sidecarStateActions.markDirty(userKey, new Set([...bookItemIds, ...podcastItemIds]));
  sidecarStateActions.setBackfilled(userKey, true);
  scheduleFlush();
};

// ---------------------------------------------------------------------------
// Per-item sync

type ScopedRecord = { record: SidecarBookmarkRecord; scope: string };

const localBookRecords = (userKey: string, libraryItemId: string) =>
  Object.values(deviceBooksStore.getState().localBookmarksByUser[userKey] ?? {}).filter(
    (record) => record.libraryItemId === libraryItemId,
  );

const localEpisodeRecords = (userKey: string, libraryItemId: string) =>
  Object.values(episodeBookmarksStore.getState().recordsByUser[userKey] ?? {}).filter(
    (record) => record.identity.libraryItemId === libraryItemId,
  );

const loadItem = (libraryItemId: string) =>
  absClient.get<LibraryItem>(`/api/items/${encodeURIComponent(libraryItemId)}?expanded=1`);

const itemInFlight = new Map<string, Promise<SidecarSyncResult>>();

export const syncBookmarkSidecar = (
  libraryItemId: string,
  options: SidecarSyncOptions = {},
): Promise<SidecarSyncResult> => {
  const key = `${libraryItemId}::${JSON.stringify(options)}`;
  const existing = itemInFlight.get(key);
  if (existing) return existing;
  const run = runSync(libraryItemId, options).finally(() => itemInFlight.delete(key));
  itemInFlight.set(key, run);
  return run;
};

const runSync = async (
  libraryItemId: string,
  options: SidecarSyncOptions,
): Promise<SidecarSyncResult> => {
  const context = getActiveContext();
  if (!context) return "unavailable";
  const companionUrl = await resolveCompanion();
  if (!companionUrl) return "unavailable";
  const { userKey } = context;
  const startedAt = Date.now();

  try {
    const item = await loadItem(libraryItemId);
    sidecarStateActions.setItemTitle(userKey, libraryItemId, item.media?.metadata?.title);
    if (item.isFile) {
      sidecarStateActions.clearDirty(userKey, libraryItemId, startedAt);
      return "unsupported";
    }
    const remote = await companionClient.getSidecar(companionUrl, libraryItemId);
    const result = await reconcileItem(context, companionUrl, item, remote, options);
    sidecarStateActions.clearDirty(userKey, libraryItemId, startedAt);
    sidecarStateActions.setLastError(userKey, libraryItemId, null);
    return result;
  } catch (error) {
    // The item is gone or no longer accessible: stop retrying it.
    if (error instanceof AbsApiError && (error.status === 403 || error.status === 404)) {
      sidecarStateActions.clearDirty(userKey, libraryItemId, startedAt);
    }
    sidecarStateActions.setLastError(
      userKey,
      libraryItemId,
      error instanceof Error ? error.message : "Bookmark sync failed",
    );
    return "error";
  }
};

const reconcileItem = async (
  context: ActiveContext,
  companionUrl: string,
  item: LibraryItem,
  remote: BookmarkSidecarDocument | null,
  options: SidecarSyncOptions,
): Promise<SidecarSyncResult> => {
  const { userKey } = context;
  const libraryItemId = item.id;
  const isPodcast = item.mediaType === "podcast";
  const accepted = new Set(options.acceptScopes ?? []);
  const sidecarState = bookmarkSidecarStore.getState();
  const synced = sidecarState.syncedByUser[userKey] ?? {};
  const scopeStates = sidecarState.scopeStateByUser[userKey] ?? {};
  const episodes: CurrentEpisode[] = isPodcast ? (item.media.episodes ?? []).map(currentEpisode) : [];
  const currentFingerprint = isPodcast ? null : bookAudioFingerprint(item);

  // --- Gather both sides, tagged with their sync scope.
  const bookRecords = isPodcast ? [] : localBookRecords(userKey, libraryItemId);
  const episodeRecords = isPodcast ? localEpisodeRecords(userKey, libraryItemId) : [];
  const markers = Object.values(sidecarState.deletionMarkersByUser[userKey] ?? {}).filter(
    (marker) => marker.libraryItemId === libraryItemId,
  );

  const localScoped: ScopedRecord[] = [
    ...bookRecords.map((record) => ({
      record: bookRecordToSidecar(record, synced[record.id]),
      scope: sidecarScopeKey(libraryItemId),
    })),
    ...episodeRecords.map((record) => {
      const episode = episodes.find((entry) => entry.episodeId === record.identity.episodeId);
      return {
        record: episodeRecordToSidecar(record, {
          episodeId: record.identity.episodeId,
          audioRelPath: episode?.audioRelPath ?? null,
        }),
        scope: sidecarScopeKey(libraryItemId, isPodcast ? record.identity.episodeId : null),
      };
    }),
  ];
  // Episode records also take their effective updatedAt from the synced map.
  localScoped.forEach((entry) => {
    const syncedEntry = synced[entry.record.id];
    if (syncedEntry && syncedEntry.hash === recordContentHash(entry.record)) {
      entry.record = { ...entry.record, updatedAt: syncedEntry.updatedAt };
    }
  });
  const localIds = new Set(localScoped.map((entry) => entry.record.id));
  markers
    .filter((marker) => !localIds.has(marker.id))
    .forEach(({ libraryItemId: _itemId, ...record }) => {
      const scope = isPodcast
        ? (scopeOfRemote(remote?.records.find((entry) => entry.id === record.id), libraryItemId, episodes) ??
          sidecarScopeKey(libraryItemId))
        : sidecarScopeKey(libraryItemId);
      localScoped.push({ record, scope });
    });

  const remoteScoped: ScopedRecord[] = (remote?.records ?? []).map((record) => ({
    record,
    scope: isPodcast
      ? (scopeOfRemote(record, libraryItemId, episodes) ?? `unresolved::${record.episode?.episodeId ?? ""}`)
      : sidecarScopeKey(libraryItemId),
  }));

  // --- Decide which scopes are blocked by an Audio Fingerprint mismatch or a pause.
  const blocked = new Set<string>();
  const scopeKeys = new Set([...localScoped, ...remoteScoped].map((entry) => entry.scope));
  scopeKeys.forEach((scope) => {
    if (scope.startsWith("unresolved::")) {
      blocked.add(scope);
      return;
    }
    const stored = storedFingerprintForScope(scope, remote, remoteScoped, isPodcast);
    const current = isPodcast ? episodeFingerprintForScope(scope, episodes) : currentFingerprint;
    const fingerprintMatches = isPodcast
      ? episodeDurationsMatch(stored?.durationSeconds, current?.durationSeconds)
      : audioFingerprintsMatch(stored, current);
    const existingState = scopeStates[scope];

    if (accepted.has(scope)) {
      sidecarStateActions.setScopeState(userKey, scope, null);
      return;
    }
    if (fingerprintMatches) {
      // The other side caught up (or the audio was restored): the notice goes away.
      if (existingState) sidecarStateActions.setScopeState(userKey, scope, null);
      return;
    }
    blocked.add(scope);
    const nextState: ScopeSyncState = {
      status: existingState?.status === "paused" ? "paused" : "mismatch",
      storedFingerprint: stored,
      currentFingerprint: current,
      remoteRecordCount: remoteScoped.filter(
        (entry) => entry.scope === scope && !entry.record.deletedAt,
      ).length,
      localRecordCount: localScoped.filter(
        (entry) => entry.scope === scope && !entry.record.deletedAt,
      ).length,
    };
    if (
      !existingState ||
      existingState.status !== nextState.status ||
      existingState.remoteRecordCount !== nextState.remoteRecordCount ||
      existingState.localRecordCount !== nextState.localRecordCount ||
      !sameAudioFingerprint(existingState.storedFingerprint, nextState.storedFingerprint) ||
      !sameAudioFingerprint(existingState.currentFingerprint, nextState.currentFingerprint)
    ) {
      sidecarStateActions.setScopeState(userKey, scope, nextState);
    }
  });

  const allowed = (entry: ScopedRecord) => !blocked.has(entry.scope);
  const localAllowed = localScoped.filter(allowed);
  const remoteAllowed = remoteScoped.filter(allowed);
  const remoteAllowedRecords = remoteAllowed.map((entry) => entry.record);

  // --- Merge, or build a replacement for the confirmed scopes.
  let outgoing: SidecarBookmarkRecord[];
  let unsentDuplicateIds = new Set<string>();
  if (options.replace) {
    const now = Date.now();
    const replaced = new Set(accepted);
    const keptRemote = remoteScoped.filter((entry) => !replaced.has(entry.scope)).map((entry) => entry.record);
    const replacing = localScoped.filter((entry) => replaced.has(entry.scope));
    const replacingIds = new Set(replacing.map((entry) => entry.record.id));
    // Deletion markers so other devices' stale copies of the replaced records lose.
    const removed = remoteScoped
      .filter((entry) => replaced.has(entry.scope) && !replacingIds.has(entry.record.id))
      .map((entry) => ({ ...entry.record, updatedAt: now, deletedAt: now }));
    outgoing = [
      ...keptRemote,
      ...replacing.map((entry) => ({ ...entry.record, updatedAt: Math.max(entry.record.updatedAt, now) })),
      ...removed,
    ];
  } else {
    outgoing = mergeSidecarRecords(
      localAllowed.map((entry) => entry.record),
      remoteAllowedRecords,
    );
    if (!isPodcast) {
      const duplicateIds = findSameSecondDuplicates(outgoing);
      const now = Date.now();
      outgoing = outgoing.map((record) =>
        duplicateIds.has(record.id) ? { ...record, updatedAt: now, deletedAt: now } : record,
      );
      const remoteIds = new Set(remoteAllowedRecords.map((record) => record.id));
      unsentDuplicateIds = new Set([...duplicateIds].filter((id) => !remoteIds.has(id)));
    }
  }

  const allowedOutgoing = outgoing.filter(
    (record) => !blocked.has(scopeForOutgoing(record, localScoped, remoteScoped)),
  );
  applyToLocal(userKey, libraryItemId, isPodcast, allowedOutgoing, bookRecords, episodeRecords, episodes);
  // A duplicate the file never had only needs removing here, not a deletion marker there.
  const pushRecords = allowedOutgoing.filter((record) => !unsentDuplicateIds.has(record.id));

  // --- Push when this device knows something the file does not.
  if (remote && !isSidecarSchemaWritable(remote)) return "readOnly";
  const bookScopeBlocked = !isPodcast && blocked.has(sidecarScopeKey(libraryItemId));
  if (bookScopeBlocked) return "blocked";

  const nextEpisodeFingerprints = isPodcast
    ? buildEpisodeFingerprints(remote, allowedOutgoing, episodes)
    : null;
  const needsPush =
    options.replace ||
    !remote ||
    !areSidecarRecordListsEqual(pushRecords, remoteAllowedRecords) ||
    (!isPodcast && !sameAudioFingerprint(remote.audioFingerprint, currentFingerprint)) ||
    (isPodcast &&
      JSON.stringify(remote.episodeFingerprints ?? {}) !== JSON.stringify(nextEpisodeFingerprints ?? {}));

  if (needsPush) {
    const stored = await companionClient.putSidecar(
      companionUrl,
      libraryItemId,
      {
        mediaKind: isPodcast ? "podcast" : "book",
        item: sidecarItemInfo(item),
        audioFingerprint: currentFingerprint,
        episodeFingerprints: nextEpisodeFingerprints,
        records: options.replace ? outgoing : pushRecords,
      },
      options.replace ? "replace" : "merge",
    );
    // Another device may have written in between; take the stored result.
    const storedAllowed = stored.records.filter(
      (record) =>
        !blocked.has(
          isPodcast
            ? (scopeOfRemote(record, libraryItemId, episodes) ?? "unresolved::")
            : sidecarScopeKey(libraryItemId),
        ),
    );
    applyToLocal(
      userKey,
      libraryItemId,
      isPodcast,
      storedAllowed,
      localBookRecords(userKey, libraryItemId),
      localEpisodeRecords(userKey, libraryItemId),
      episodes,
    );
    const storedIds = new Set(stored.records.map((record) => record.id));
    sidecarStateActions.removeDeletionMarkers(
      userKey,
      markers.filter((marker) => storedIds.has(marker.id)).map((marker) => marker.id),
    );
  }

  return blocked.size > 0 ? "blocked" : "synced";
};

/** A clip adds an end time to the Server Bookmark, so it outranks a point; then the older record wins. */
const outranks = (left: SidecarBookmarkRecord, right: SidecarBookmarkRecord) => {
  if (left.kind !== right.kind) return left.kind === "clip";
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt;
  return left.id < right.id;
};

/**
 * Audiobookshelf keys a Server Bookmark by its second, and a Local Bookmark
 * Record is that bookmark plus an optional end time, so a book holds one record
 * per second. A bookmark made on another device can reach this one through ADR
 * 0001 reconciliation as a new point record with its own id, and the per-record
 * merge then keeps both it and the original from the Bookmark Sidecar. Every
 * record but the highest-ranked one at a second is a duplicate.
 */
export const findSameSecondDuplicates = (records: readonly SidecarBookmarkRecord[]) => {
  const keepers = new Map<number, SidecarBookmarkRecord>();
  records
    .filter((record) => !record.deletedAt)
    .forEach((record) => {
      const keeper = keepers.get(record.startTimeSeconds);
      if (!keeper || outranks(record, keeper)) keepers.set(record.startTimeSeconds, record);
    });
  const keeperIds = new Set([...keepers.values()].map((record) => record.id));
  return new Set(
    records.filter((record) => !record.deletedAt && !keeperIds.has(record.id)).map((record) => record.id),
  );
};

const scopeOfRemote = (
  record: SidecarBookmarkRecord | undefined,
  libraryItemId: string,
  episodes: readonly CurrentEpisode[],
) => {
  if (!record) return null;
  const episodeId = resolveSidecarEpisodeId(record.episode, episodes);
  return episodeId ? sidecarScopeKey(libraryItemId, episodeId) : null;
};

const scopeForOutgoing = (
  record: SidecarBookmarkRecord,
  local: readonly ScopedRecord[],
  remote: readonly ScopedRecord[],
) =>
  local.find((entry) => entry.record.id === record.id)?.scope ??
  remote.find((entry) => entry.record.id === record.id)?.scope ??
  "";

const storedFingerprintForScope = (
  scope: string,
  remote: BookmarkSidecarDocument | null,
  remoteScoped: readonly ScopedRecord[],
  isPodcast: boolean,
): SidecarAudioFingerprint | null => {
  if (!remote) return null;
  if (!isPodcast) return remote.audioFingerprint;
  const ref = remoteScoped.find((entry) => entry.scope === scope && entry.record.episode)?.record
    .episode;
  const duration = ref ? remote.episodeFingerprints?.[episodeFingerprintKey(ref)] : undefined;
  return typeof duration === "number" ? { durationSeconds: duration, trackCount: 1 } : null;
};

const episodeFingerprintForScope = (
  scope: string,
  episodes: readonly CurrentEpisode[],
): SidecarAudioFingerprint | null => {
  const episodeId = scope.slice(scope.indexOf("::") + 2);
  const duration = episodes.find((episode) => episode.episodeId === episodeId)?.durationSeconds;
  return typeof duration === "number" ? { durationSeconds: duration, trackCount: 1 } : null;
};

/** Stored Episode fingerprints for blocked scopes stay; allowed scopes take today's durations. */
const buildEpisodeFingerprints = (
  remote: BookmarkSidecarDocument | null,
  records: readonly SidecarBookmarkRecord[],
  episodes: readonly CurrentEpisode[],
) => {
  const next: Record<string, number> = { ...(remote?.episodeFingerprints ?? {}) };
  records.forEach((record) => {
    const episodeId = resolveSidecarEpisodeId(record.episode, episodes);
    const episode = episodes.find((entry) => entry.episodeId === episodeId);
    if (episode && typeof episode.durationSeconds === "number") {
      next[episodeFingerprintKey(episode)] = episode.durationSeconds;
    }
  });
  return next;
};

/**
 * Write what the Bookmark Sidecar side won into the local stores. The synced map
 * is updated first so the change tracker does not mistake these for edits.
 */
const applyToLocal = (
  userKey: string,
  libraryItemId: string,
  isPodcast: boolean,
  records: readonly SidecarBookmarkRecord[],
  bookRecords: readonly LocalBookmarkRecord[],
  episodeRecords: readonly EpisodeBookmarkRecord[],
  episodes: readonly CurrentEpisode[],
) => {
  const syncedEntries: Record<string, SyncedEntry> = {};
  const syncedRemovals: string[] = [];
  const bookUpserts: LocalBookmarkRecord[] = [];
  const episodeUpserts: EpisodeBookmarkRecord[] = [];
  const removeIds: string[] = [];
  const localBookById = new Map(bookRecords.map((record) => [record.id, record]));
  const localEpisodeById = new Map(episodeRecords.map((record) => [record.id, record]));

  records.forEach((record) => {
    if (record.deletedAt) {
      syncedRemovals.push(record.id);
      if (localBookById.has(record.id) || localEpisodeById.has(record.id)) removeIds.push(record.id);
      return;
    }
    syncedEntries[record.id] = {
      hash: recordContentHash(record),
      updatedAt: record.updatedAt,
      libraryItemId,
      media: isPodcast ? "episode" : "book",
    };

    if (isPodcast) {
      const episodeId = resolveSidecarEpisodeId(record.episode, episodes);
      if (!episodeId) return;
      const existing = localEpisodeById.get(record.id);
      const incoming = sidecarToEpisodeRecord(record, userKey, libraryItemId, episodeId);
      if (
        !existing ||
        existing.identity.episodeId !== episodeId ||
        recordContentHash(episodeRecordToSidecar(existing, record.episode ?? { episodeId, audioRelPath: null })) !==
          recordContentHash(record)
      ) {
        episodeUpserts.push(incoming);
      }
      return;
    }

    const existing = localBookById.get(record.id);
    const existingHash = existing ? recordContentHash(bookRecordToSidecar(existing)) : null;
    if (!existing || existingHash !== recordContentHash(record)) {
      // Covers a record re-linked to a new library item id after an ABS rebuild.
      bookUpserts.push(sidecarToBookRecord(record, libraryItemId, existing));
    }
  });

  sidecarStateActions.setSynced(userKey, syncedEntries, syncedRemovals);
  if (isPodcast) {
    episodeBookmarksStore.getState().actions.applySidecarRecords(userKey, {
      upserts: episodeUpserts,
      removeIds,
    });
  } else {
    deviceBooksStore.getState().actions.applySidecarBookmarks(userKey, {
      upserts: bookUpserts,
      removeIds,
    });
  }
};

// ---------------------------------------------------------------------------
// Mismatch choices (ADR 0046): nothing here ever removes device bookmarks.

export const loadSidecarAnyway = (libraryItemId: string, scope: string) =>
  syncBookmarkSidecar(libraryItemId, { acceptScopes: [scope] });

export const pauseSidecarScope = (scope: string) => {
  const userKey = authStore.getState().storedUserId?.trim();
  if (!userKey) return;
  const existing = bookmarkSidecarStore.getState().scopeStateByUser[userKey]?.[scope];
  if (existing) sidecarStateActions.setScopeState(userKey, scope, { ...existing, status: "paused" });
};

export const replaceServerBookmarks = (libraryItemId: string, scope: string) =>
  syncBookmarkSidecar(libraryItemId, { acceptScopes: [scope], replace: true });

// ---------------------------------------------------------------------------
// Change tracking and flushing

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

export const flushBookmarkSidecars = async () => {
  if (flushing) return flushing;
  flushing = (async () => {
    const context = getActiveContext();
    if (!context) return;
    if (!(await resolveCompanion())) return;
    const dirty = Object.keys(bookmarkSidecarStore.getState().dirtyItemsByUser[context.userKey] ?? {});
    for (const libraryItemId of dirty) {
      await syncBookmarkSidecar(libraryItemId);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
};

const scheduleFlush = () => {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBookmarkSidecars();
  }, FLUSH_DEBOUNCE_MS);
};

/**
 * Mark items dirty whose bookmarks differ from what was last synced. Deletions
 * are recorded explicitly by the stores' delete actions, never inferred here,
 * so a cleared store can never turn into server-side deletions. This runs even
 * while no LAABS Companion is known to answer, so an edit made then still syncs
 * once one does; flushing is a no-op until then.
 */
const trackChanges = (
  userKey: string,
  records: readonly { id: string; libraryItemId: string; sidecar: SidecarBookmarkRecord }[],
) => {
  const synced = bookmarkSidecarStore.getState().syncedByUser[userKey] ?? {};
  const dirty = new Set<string>();
  records.forEach(({ id, libraryItemId, sidecar }) => {
    const entry = synced[id];
    if (!entry || entry.libraryItemId !== libraryItemId || entry.hash !== recordContentHash(sidecar)) {
      dirty.add(libraryItemId);
    }
  });
  if (!dirty.size) return;
  sidecarStateActions.markDirty(userKey, dirty);
  scheduleFlush();
};

let stopTracking: (() => void) | null = null;

/** Start once at app bootstrap. Returns a stop function. */
export const startBookmarkSidecarSync = () => {
  if (stopTracking) return stopTracking;

  const unsubscribeBooks = deviceBooksStore.subscribe((state, previous) => {
    const userKey = authStore.getState().storedUserId?.trim();
    if (!userKey) return;
    const current = state.localBookmarksByUser[userKey];
    if (!current || current === previous.localBookmarksByUser[userKey]) return;
    trackChanges(
      userKey,
      Object.values(current).map((record) => ({
        id: record.id,
        libraryItemId: record.libraryItemId,
        sidecar: bookRecordToSidecar(record),
      })),
    );
  });

  const unsubscribeEpisodes = episodeBookmarksStore.subscribe((state, previous) => {
    const userKey = authStore.getState().storedUserId?.trim();
    if (!userKey) return;
    const current = state.recordsByUser[userKey];
    if (!current || current === previous.recordsByUser[userKey]) return;
    trackChanges(
      userKey,
      Object.values(current).map((record) => ({
        id: record.id,
        libraryItemId: record.identity.libraryItemId,
        sidecar: episodeRecordToSidecar(record, {
          episodeId: record.identity.episodeId,
          audioRelPath: null,
        }),
      })),
    );
  });

  // Another device's edits only arrive by pulling, so the item being listened
  // to is pulled whenever it loads and whenever the app comes back.
  const pullPlayingItem = (libraryItemId: string | null) => {
    if (libraryItemId && !isImportedAudiobookId(libraryItemId)) {
      void syncBookmarkSidecar(libraryItemId);
    }
  };
  const unsubscribePlayback = playbackStore.subscribe((state, previous) => {
    if (state.libraryItemId !== previous.libraryItemId) pullPlayingItem(state.libraryItemId);
  });

  const appStateSubscription = AppState.addEventListener("change", (nextState) => {
    if (nextState !== "active") return;
    void flushBookmarkSidecars();
    pullPlayingItem(playbackStore.getState().libraryItemId);
  });

  stopTracking = () => {
    unsubscribeBooks();
    unsubscribeEpisodes();
    unsubscribePlayback();
    appStateSubscription.remove();
    if (flushTimer) clearTimeout(flushTimer);
    stopTracking = null;
  };
  return stopTracking;
};
