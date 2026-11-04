import type { ScopeSyncState } from "./bookmark-sidecar-store";

/**
 * Per-item Bookmark Sidecar sync status for Settings → LAABS Companion
 * (ADR 0046). Pure so it can be tested without the stores.
 */

export type SidecarSyncItemStatus = "error" | "attention" | "waiting" | "synced";

export type SidecarSyncItemRow = {
  libraryItemId: string;
  media: "book" | "podcast";
  title: string | null;
  bookmarkCount: number;
  status: SidecarSyncItemStatus;
  /** Error message, or what the user needs to do for an item that needs attention. */
  detail: string | null;
};

export type SidecarSyncStatusInput = {
  bookItemIds: readonly string[];
  podcastItemIds: readonly string[];
  dirtyItemIds: readonly string[];
  /** Keyed by library item id. */
  errors: Readonly<Record<string, string>>;
  /** Keyed by sync scope: `libraryItemId` or `libraryItemId::episodeId`. */
  scopeStates: Readonly<Record<string, ScopeSyncState>>;
  titleFor: (libraryItemId: string) => string | null;
};

const STATUS_ORDER: Record<SidecarSyncItemStatus, number> = {
  error: 0,
  attention: 1,
  waiting: 2,
  synced: 3,
};

const MISMATCH_DETAIL =
  "The audio has changed since these bookmarks were saved. Open its bookmarks to choose what to keep.";
const PAUSED_DETAIL = "Sync is paused for this item. Open its bookmarks to resume.";

const scopeItemId = (scopeKey: string) => {
  const separator = scopeKey.indexOf("::");
  return separator === -1 ? scopeKey : scopeKey.slice(0, separator);
};

export const buildSidecarSyncRows = (input: SidecarSyncStatusInput): SidecarSyncItemRow[] => {
  const counts = new Map<string, { media: "book" | "podcast"; count: number }>();
  const count = (ids: readonly string[], media: "book" | "podcast") => {
    ids.forEach((id) => {
      const entry = counts.get(id) ?? { media, count: 0 };
      entry.count += 1;
      counts.set(id, entry);
    });
  };
  count(input.bookItemIds, "book");
  count(input.podcastItemIds, "podcast");

  const attention = new Map<string, string>();
  Object.entries(input.scopeStates).forEach(([scopeKey, state]) => {
    const id = scopeItemId(scopeKey);
    // A mismatch needs a decision; it outranks a pause on another episode of the same podcast.
    if (state.status === "mismatch" || !attention.has(id)) {
      attention.set(id, state.status === "mismatch" ? MISMATCH_DETAIL : PAUSED_DETAIL);
    }
  });

  const dirty = new Set(input.dirtyItemIds);
  // Items with only deletions waiting to upload have no local bookmarks left but still sync.
  const ids = new Set([...counts.keys(), ...dirty, ...Object.keys(input.errors), ...attention.keys()]);

  const rows = [...ids].map((libraryItemId): SidecarSyncItemRow => {
    const error = input.errors[libraryItemId];
    const attentionDetail = attention.get(libraryItemId);
    const status: SidecarSyncItemStatus = error
      ? "error"
      : attentionDetail
        ? "attention"
        : dirty.has(libraryItemId)
          ? "waiting"
          : "synced";
    return {
      libraryItemId,
      media: counts.get(libraryItemId)?.media ?? "book",
      title: input.titleFor(libraryItemId),
      bookmarkCount: counts.get(libraryItemId)?.count ?? 0,
      status,
      detail: error ?? attentionDetail ?? null,
    };
  });

  return rows.sort(
    (left, right) =>
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
      (left.title ?? "￿").localeCompare(right.title ?? "￿") ||
      left.libraryItemId.localeCompare(right.libraryItemId),
  );
};
