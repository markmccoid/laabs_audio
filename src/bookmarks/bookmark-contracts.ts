export type BookmarkTarget =
  | {
      mediaKind: "book";
      libraryItemId: string;
      episodeId: null;
    }
  | {
      mediaKind: "episode";
      libraryItemId: string;
      episodeId: string;
    };

export type BookmarkKind = "point" | "clip";

export type BookmarkViewRecord = {
  id: string;
  kind: BookmarkKind;
  startTimeSeconds: number;
  endTimeSeconds?: number | null;
  title: string;
  note?: string | null;
  createdAt: number;
  updatedAt: number;
  statusLabel?: string | null;
};

export type BookmarkDraft = {
  kind: BookmarkKind;
  title: string;
  note: string;
  startTimeSeconds: number;
  endTimeSeconds: number | null;
  createdAt?: number;
};

export const areBookmarkDraftAndRecordEqual = (
  draft: BookmarkDraft,
  record: BookmarkViewRecord,
) =>
  draft.kind === record.kind &&
  draft.title.trim() === record.title.trim() &&
  draft.note.trim() === (record.note ?? "").trim() &&
  Math.round(draft.startTimeSeconds) === Math.round(record.startTimeSeconds) &&
  (draft.kind === "clip" ? Math.round(draft.endTimeSeconds ?? 0) : null) ===
    (record.kind === "clip" ? Math.round(record.endTimeSeconds ?? 0) : null);

/**
 * The Local Bookmark Record that already occupies a start second, if any.
 *
 * `addBookmark` infers record identity from `(libraryItemId, startTimeSeconds)`,
 * so saving onto an occupied second silently rewrites that record's title, note
 * and range. Read-Along hits this constantly — every selection anchored on the
 * same sentence floors to the same second — so the save flow looks first and
 * asks the user whether they meant Replace or Save as new (ADR 0035).
 *
 * Rounding must match the store's own `normalizeBookmarkSeconds` (floor, clamped
 * at zero) or the check would miss the very collision it exists to catch.
 */
export const normalizeBookmarkStartSecond = (seconds: number) =>
  Math.max(0, Math.floor(seconds));

export const findBookmarkAtStartSecond = <
  TRecord extends { id: string; libraryItemId: string; startTimeSeconds: number },
>(
  records: readonly TRecord[],
  libraryItemId: string,
  startTimeSeconds: number,
  options?: { ignoreBookmarkId?: string | null },
): TRecord | null => {
  const target = normalizeBookmarkStartSecond(startTimeSeconds);
  return (
    records.find(
      (record) =>
        record.libraryItemId === libraryItemId &&
        record.id !== options?.ignoreBookmarkId &&
        normalizeBookmarkStartSecond(record.startTimeSeconds) === target,
    ) ?? null
  );
};
