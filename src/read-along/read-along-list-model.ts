/**
 * Read-Along list model (`docs/read-along-implementation-plan.md` Phase 3.1).
 *
 * Turns the three things the reader loads from SQLite — the frozen section list,
 * the lean segment text rows, and the transcription frontier — into the flat,
 * typed array FlashList renders, plus the index maps Follow Mode needs.
 *
 * Import-clean on purpose (types only, no React / React Native / SQLite), so the
 * whole shape of the reader is unit-testable without a device.
 *
 * Vocabulary (CONTEXT.md): a **section** is one frozen chapter/file of the Book
 * Transcript; a **Transcript Segment** is one utterance inside it. A section is
 * *readable* iff `section.endMs <= frontierMs`; anything above the frontier
 * renders as a pending block instead of text.
 */

import type {
  BookTranscriptSection,
  TranscriptSegmentTextRow,
} from "@/data/sqlite/shadow-db-transcripts";

/**
 * The last section's `endMs` comes from the frozen chapter list while the
 * frontier is summed from track durations, so the two can disagree by a few
 * hundred ms on a book that is genuinely finished. Only the final section gets
 * this slack, and only once the transcript itself says `complete`.
 */
export const FINAL_SECTION_TOLERANCE_MS = 1000;

export type ReadAlongListItem =
  | {
      type: "sectionHeader";
      key: string;
      sectionIndex: number;
      title: string;
      startMs: number;
    }
  | {
      type: "segment";
      key: string;
      sectionIndex: number;
      /** Index into {@link ReadAlongListModel.readableSegments}. */
      segmentIndex: number;
      startMs: number;
      row: TranscriptSegmentTextRow;
    }
  | {
      type: "pendingSection";
      key: string;
      sectionIndex: number;
      title: string;
      startMs: number;
    };

export type ReadAlongListModel = {
  items: ReadAlongListItem[];
  /**
   * The segments actually rendered, in reading order — this is the array fed to
   * `useReadAlongPosition`, so `activeSegmentIndex` indexes straight into it.
   */
  readableSegments: TranscriptSegmentTextRow[];
  /** `readableSegments` index → `items` index, for Follow Mode's scrollToIndex. */
  listIndexBySegmentIndex: number[];
  /** Section indexes rendered as pending blocks, in order. */
  pendingSectionIndexes: number[];
};

export type BuildReadAlongListModelArgs = {
  /** Frozen sections from `getTranscriptSections`, or null when none exist. */
  sections: readonly BookTranscriptSection[] | null;
  /** Lean rows from `getSegmentTextRows`, ordered by section then start. */
  segments: readonly TranscriptSegmentTextRow[];
  /** Book-absolute ms from `getTranscriptFrontierMs`. */
  frontierMs: number;
  /** True when the Book Transcript row's status is `complete`. */
  isTranscriptComplete: boolean;
};

const EMPTY_MODEL: ReadAlongListModel = {
  items: [],
  readableSegments: [],
  listIndexBySegmentIndex: [],
  pendingSectionIndexes: [],
};

/** A section is readable iff its end is at or below the frontier. */
export const isSectionReadable = ({
  section,
  frontierMs,
  isFinalSection,
  isTranscriptComplete,
}: {
  section: BookTranscriptSection;
  frontierMs: number;
  isFinalSection: boolean;
  isTranscriptComplete: boolean;
}): boolean => {
  if (section.endMs <= frontierMs) return true;
  return (
    isTranscriptComplete &&
    isFinalSection &&
    section.endMs <= frontierMs + FINAL_SECTION_TOLERANCE_MS
  );
};

const groupSegmentsBySection = (segments: readonly TranscriptSegmentTextRow[]) => {
  const bySection = new Map<number, TranscriptSegmentTextRow[]>();
  for (const row of segments) {
    const bucket = bySection.get(row.sectionIndex);
    if (bucket) bucket.push(row);
    else bySection.set(row.sectionIndex, [row]);
  }
  return bySection;
};

/**
 * Build the flat FlashList data plus its index maps.
 *
 * - Sections are emitted in `index` order; each readable one contributes a
 *   header followed by its segments, each unreadable one a header followed by a
 *   single pending block.
 * - A readable section that holds no segments emits neither header nor block
 *   (an empty chapter would otherwise read as a bug).
 * - Segments whose `sectionIndex` matches no section (defensive; shouldn't
 *   happen) are appended, headerless, after the sections so no text is lost.
 * - With no sections at all the model is empty: that is Phase 4's no-transcript
 *   state, not a reader state.
 */
export const buildReadAlongListModel = ({
  sections,
  segments,
  frontierMs,
  isTranscriptComplete,
}: BuildReadAlongListModelArgs): ReadAlongListModel => {
  if (!sections || sections.length === 0) return EMPTY_MODEL;

  const orderedSections = [...sections].sort((a, b) => a.index - b.index);
  const segmentsBySection = groupSegmentsBySection(segments);
  const claimedSectionIndexes = new Set<number>();

  const items: ReadAlongListItem[] = [];
  const readableSegments: TranscriptSegmentTextRow[] = [];
  const listIndexBySegmentIndex: number[] = [];
  const pendingSectionIndexes: number[] = [];

  const pushSegment = (row: TranscriptSegmentTextRow) => {
    const segmentIndex = readableSegments.length;
    readableSegments.push(row);
    listIndexBySegmentIndex.push(items.length);
    items.push({
      type: "segment",
      key: `segment:${row.id}`,
      sectionIndex: row.sectionIndex,
      segmentIndex,
      startMs: row.startMs,
      row,
    });
  };

  orderedSections.forEach((section, orderedIndex) => {
    claimedSectionIndexes.add(section.index);
    const sectionSegments = segmentsBySection.get(section.index) ?? [];
    const readable = isSectionReadable({
      section,
      frontierMs,
      isFinalSection: orderedIndex === orderedSections.length - 1,
      isTranscriptComplete,
    });

    if (readable && sectionSegments.length === 0) return;

    items.push({
      type: "sectionHeader",
      key: `section:${section.index}`,
      sectionIndex: section.index,
      title: section.title,
      startMs: section.startMs,
    });

    if (readable) {
      for (const row of sectionSegments) pushSegment(row);
      return;
    }

    pendingSectionIndexes.push(section.index);
    items.push({
      type: "pendingSection",
      key: `pending:${section.index}`,
      sectionIndex: section.index,
      title: section.title,
      startMs: section.startMs,
    });
  });

  for (const row of segments) {
    if (claimedSectionIndexes.has(row.sectionIndex)) continue;
    pushSegment(row);
  }

  return { items, readableSegments, listIndexBySegmentIndex, pendingSectionIndexes };
};

/**
 * Where in the list a given book position belongs — the last item that has
 * started. Unlike `findActiveSegmentIndex` this deliberately has **no gap
 * rule**: it answers "where should the reader be looking?", so a position in
 * silence, past the frontier, or inside a pending chapter still resolves to the
 * nearest preceding row. Used for the first scroll on open and as Follow Mode's
 * target whenever nothing is highlighted.
 *
 * Returns -1 when the position is before the first item.
 */
export const findListIndexForPosition = (
  items: readonly ReadAlongListItem[],
  positionMs: number,
): number => {
  if (!Number.isFinite(positionMs) || items.length === 0) return -1;

  let low = 0;
  let high = items.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (items[mid].startMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
};
