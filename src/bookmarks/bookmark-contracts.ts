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
