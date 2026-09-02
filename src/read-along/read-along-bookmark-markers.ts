/**
 * Bookmark Gutter markers (ADR 0035).
 *
 * Maps the audiobook's saved Bookmarks onto the Transcript Segments the reader
 * is showing, so each row can draw its slice of the margin lane: a Clip Bookmark
 * as a rule spanning its segments, a Point Bookmark as a dot on the one segment
 * that contains it.
 *
 * ## Why midpoints
 *
 * A Clip Range's boundaries are whole seconds derived by flooring the start and
 * ceiling the end, so a clip's stored range reaches slightly outside the
 * sentences it was made from. Testing a segment's **midpoint** for containment
 * absorbs that slop in both directions; testing its start would let the floor
 * pull in the preceding sentence whenever the two share a second.
 *
 * ## Referential stability (load-bearing)
 *
 * `read-along-segment-props.ts` compares `markers` by identity, so every row
 * must get the *same array instance* across renders until the bookmarks actually
 * change. Rows with no marker all share {@link NO_MARKERS}.
 */

import type { TranscriptSegmentTextRow } from "@/data/sqlite/shadow-db-transcripts";
import type { LocalBookmarkRecord } from "@/store/device-books-store";

export type ReadAlongBookmarkMarker = {
  bookmarkId: string;
  kind: "point" | "clip";
  title: string;
  /** True on the first segment of a clip's run — where the rule's cap is drawn. */
  isRangeStart: boolean;
  /** True on the last segment of a clip's run. */
  isRangeEnd: boolean;
};

export const NO_MARKERS: readonly ReadAlongBookmarkMarker[] = Object.freeze([]);

/** Segment id → the markers whose bookmark covers it. */
export type ReadAlongBookmarkMarkerMap = ReadonlyMap<number, readonly ReadAlongBookmarkMarker[]>;

const midpointMs = (segment: TranscriptSegmentTextRow) =>
  (segment.startMs + segment.endMs) / 2;

/**
 * The segment a Point Bookmark belongs to: the one containing its position, or —
 * when it lands in a gap between segments or past the last one — the nearest
 * preceding segment, so a point is never silently dropped from the gutter.
 */
const findSegmentIndexForPosition = (
  segments: readonly TranscriptSegmentTextRow[],
  positionMs: number,
) => {
  let candidate = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.startMs > positionMs) break;
    candidate = index;
    if (segment.endMs > positionMs) return index;
  }
  return candidate;
};

export const buildBookmarkMarkerMap = ({
  bookmarks,
  segments,
}: {
  bookmarks: readonly LocalBookmarkRecord[];
  segments: readonly TranscriptSegmentTextRow[];
}): ReadAlongBookmarkMarkerMap => {
  const map = new Map<number, ReadAlongBookmarkMarker[]>();
  if (segments.length === 0) return map;

  const push = (segment: TranscriptSegmentTextRow, marker: ReadAlongBookmarkMarker) => {
    const existing = map.get(segment.id);
    if (existing) existing.push(marker);
    else map.set(segment.id, [marker]);
  };

  for (const bookmark of bookmarks) {
    const title = bookmark.title.trim();

    if (bookmark.kind === "clip" && typeof bookmark.endTimeSeconds === "number") {
      const startMs = bookmark.startTimeSeconds * 1000;
      const endMs = bookmark.endTimeSeconds * 1000;
      const covered: TranscriptSegmentTextRow[] = [];
      for (const segment of segments) {
        const mid = midpointMs(segment);
        if (mid >= startMs && mid < endMs) covered.push(segment);
        else if (mid >= endMs) break;
      }
      // A clip whose range falls entirely inside one ASR gap covers nothing;
      // fall back to the segment its start belongs to so it still appears.
      if (covered.length === 0) {
        const index = findSegmentIndexForPosition(segments, startMs);
        if (index < 0) continue;
        push(segments[index], {
          bookmarkId: bookmark.id,
          kind: "clip",
          title,
          isRangeStart: true,
          isRangeEnd: true,
        });
        continue;
      }
      covered.forEach((segment, offset) => {
        push(segment, {
          bookmarkId: bookmark.id,
          kind: "clip",
          title,
          isRangeStart: offset === 0,
          isRangeEnd: offset === covered.length - 1,
        });
      });
      continue;
    }

    const index = findSegmentIndexForPosition(segments, bookmark.startTimeSeconds * 1000);
    if (index < 0) continue;
    push(segments[index], {
      bookmarkId: bookmark.id,
      kind: "point",
      title,
      isRangeStart: true,
      isRangeEnd: true,
    });
  }

  return map;
};

export const getMarkersForSegment = (
  map: ReadAlongBookmarkMarkerMap,
  segmentId: number,
): readonly ReadAlongBookmarkMarker[] => map.get(segmentId) ?? NO_MARKERS;
