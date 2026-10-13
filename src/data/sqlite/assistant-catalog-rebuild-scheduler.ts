import type { AssistantDownloadedBookInput } from "./assistant-catalog-writes";
import {
  AssistantCatalogRebuildCancelledError,
  rebuildAssistantCatalog,
} from "./assistant-catalog-writes";
import { recordTimingLog } from "./timing-logger";

/**
 * Coalesces Assistant Catalog rebuilds so they never block User Session Entry or Home.
 *
 * A rebuild rewrites thousands of rows under the shared write guard (7–11 s for a 3k-book
 * library), so it runs in the background, at most one at a time, for the latest request only.
 * The SQLite refresh holds rebuilds while it writes, then requests one, so a session switch
 * builds the catalog once, from fresh data. See docs/library-switch-performance-todo.md.
 */

type RebuildRequest = {
  userId: string;
  downloadedBooks: readonly AssistantDownloadedBookInput[];
  source: string;
};

type SchedulerState = {
  pending: RebuildRequest | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  holds: number;
  currentUserId: (() => string | null) | null;
  /** Bumped by cancel; a running rebuild from an older generation stops at its next chunk. */
  generation: number;
};

const state: SchedulerState = ((globalThis as typeof globalThis & {
  __laabsAssistantRebuildScheduler?: SchedulerState;
}).__laabsAssistantRebuildScheduler ??= {
  pending: null,
  timer: null,
  running: false,
  holds: 0,
  currentUserId: null,
  generation: 0,
});

/**
 * Supplies the active User Identity. A request for any other user is dropped when it would run:
 * a refresh for the previous user can finish after a switch and must not repopulate the catalog
 * (and Spotlight) the switch just cleared, nor hold the write queue the new user needs.
 */
export const setAssistantRebuildCurrentUser = (currentUserId: () => string | null) => {
  state.currentUserId = currentUserId;
};

const drain = async () => {
  if (state.running || state.holds > 0 || state.timer || !state.pending) return;
  const request = state.pending;
  state.pending = null;
  if (state.currentUserId && state.currentUserId() !== request.userId) {
    void drain();
    return;
  }

  state.running = true;
  const startedAt = Date.now();
  const generation = state.generation;
  const isStillWanted = () =>
    state.generation === generation &&
    (!state.currentUserId || state.currentUserId() === request.userId);
  try {
    const result = await rebuildAssistantCatalog({ ...request, shouldContinue: isStillWanted });
    void recordTimingLog("library_switch", "sqlite_refresh_assistant_catalog", startedAt, {
      userId: request.userId,
      rowCount: result.rowCount,
      source: request.source,
    });
  } catch (error) {
    void recordTimingLog("library_switch", "sqlite_refresh_assistant_catalog", startedAt, {
      userId: request.userId,
      source: request.source,
      cancelled: error instanceof AssistantCatalogRebuildCancelledError,
      error: error instanceof Error ? error.message : "Assistant Catalog rebuild failed",
    });
  } finally {
    state.running = false;
    void drain();
  }
};

/** Replaces any pending request (latest wins) and runs it after `delayMs` once nothing holds. */
export const requestAssistantCatalogRebuild = (
  request: RebuildRequest,
  options: { delayMs?: number } = {},
) => {
  state.pending = request;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void drain();
  }, options.delayMs ?? 0);
};

/** Defers rebuilds (e.g. while a refresh writes); the returned release lets a pending one run. */
export const holdAssistantCatalogRebuilds = () => {
  state.holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.holds = Math.max(0, state.holds - 1);
    void drain();
  };
};

/**
 * Drops a pending rebuild and stops a running one at its next chunk (its writes roll back);
 * called when crossing a User Session boundary, so the boundary is not stuck behind it.
 */
export const cancelAssistantCatalogRebuilds = () => {
  state.generation += 1;
  state.pending = null;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
};
