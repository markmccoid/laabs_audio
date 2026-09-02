import type { TranscriptSegmentTextRow } from "@/data/sqlite/shadow-db-transcripts";
import type { LocalBookmarkRecord } from "@/store/device-books-store";
import {
  buildBookmarkMarkerMap,
  getMarkersForSegment,
  NO_MARKERS,
} from "./read-along-bookmark-markers";

const segment = (
  id: number,
  startMs: number,
  endMs: number,
): TranscriptSegmentTextRow => ({
  id,
  sectionIndex: 0,
  startMs,
  endMs,
  text: `segment ${id}`,
});

// ids 1..6 at 0-3.8s, 4-7.8s, 8-11.8s, ...
const segments = Array.from({ length: 6 }, (_, index) =>
  segment(index + 1, index * 4000, index * 4000 + 3800),
);

const record = (overrides: Partial<LocalBookmarkRecord>): LocalBookmarkRecord => ({
  id: "bm-1",
  libraryItemId: "book-1",
  kind: "point",
  startTimeSeconds: 0,
  title: "Bookmark",
  note: null,
  createdAt: 0,
  updatedAt: 0,
  serverLink: { status: "matched", timeSeconds: 0, lastMatchedAt: null },
  ...overrides,
});

describe("buildBookmarkMarkerMap", () => {
  it("spans a clip across every segment whose midpoint falls inside it", () => {
    const map = buildBookmarkMarkerMap({
      segments,
      bookmarks: [
        record({ id: "clip-1", kind: "clip", startTimeSeconds: 4, endTimeSeconds: 16 }),
      ],
    });
    expect([...map.keys()].sort()).toEqual([2, 3, 4]);
    expect(getMarkersForSegment(map, 2)[0]).toMatchObject({
      bookmarkId: "clip-1",
      kind: "clip",
      isRangeStart: true,
      isRangeEnd: false,
    });
    expect(getMarkersForSegment(map, 4)[0]).toMatchObject({
      isRangeStart: false,
      isRangeEnd: true,
    });
  });

  it("does not bleed into the preceding sentence when the floored start shares its second", () => {
    // A clip made from segment 2 alone floors to 4s; segment 1 ends at 3.8s and
    // its midpoint (1.9s) is safely outside.
    const map = buildBookmarkMarkerMap({
      segments,
      bookmarks: [
        record({ id: "clip-1", kind: "clip", startTimeSeconds: 4, endTimeSeconds: 8 }),
      ],
    });
    expect([...map.keys()]).toEqual([2]);
  });

  it("marks a point on the segment that contains it", () => {
    const map = buildBookmarkMarkerMap({
      segments,
      bookmarks: [record({ id: "point-1", startTimeSeconds: 9 })],
    });
    expect([...map.keys()]).toEqual([3]);
    expect(getMarkersForSegment(map, 3)[0]).toMatchObject({
      bookmarkId: "point-1",
      kind: "point",
      isRangeStart: true,
      isRangeEnd: true,
    });
  });

  it("snaps a point in an ASR gap back to the preceding segment", () => {
    // 30s falls in the silence between segment 1 (ends 1s) and segment 2 (starts 60s).
    const gapped = [segment(1, 0, 1000), segment(2, 60_000, 63_000)];
    const map = buildBookmarkMarkerMap({
      segments: gapped,
      bookmarks: [record({ id: "point-1", startTimeSeconds: 30 })],
    });
    expect([...map.keys()]).toEqual([1]);
  });

  it("snaps a point past the last segment back onto it", () => {
    const map = buildBookmarkMarkerMap({
      segments,
      bookmarks: [record({ id: "point-1", startTimeSeconds: 600 })],
    });
    expect([...map.keys()]).toEqual([6]);
  });

  it("drops a point that precedes every segment rather than guessing", () => {
    const map = buildBookmarkMarkerMap({
      segments: [segment(9, 60_000, 63_000)],
      bookmarks: [record({ id: "point-1", startTimeSeconds: 10 })],
    });
    expect(map.size).toBe(0);
  });

  it("keeps a clip visible when its range lands entirely inside a gap", () => {
    const gapped = [segment(1, 0, 1000), segment(2, 60_000, 63_000)];
    const map = buildBookmarkMarkerMap({
      segments: gapped,
      bookmarks: [
        record({ id: "clip-1", kind: "clip", startTimeSeconds: 5, endTimeSeconds: 10 }),
      ],
    });
    expect([...map.keys()]).toEqual([1]);
    expect(getMarkersForSegment(map, 1)[0]).toMatchObject({
      isRangeStart: true,
      isRangeEnd: true,
    });
  });

  it("stacks overlapping clips on the segments they share", () => {
    const map = buildBookmarkMarkerMap({
      segments,
      bookmarks: [
        record({ id: "clip-a", kind: "clip", startTimeSeconds: 0, endTimeSeconds: 12 }),
        record({ id: "clip-b", kind: "clip", startTimeSeconds: 8, endTimeSeconds: 20 }),
      ],
    });
    expect(getMarkersForSegment(map, 3).map((marker) => marker.bookmarkId)).toEqual([
      "clip-a",
      "clip-b",
    ]);
  });

  it("ignores a clip record missing its end position", () => {
    const map = buildBookmarkMarkerMap({
      segments,
      bookmarks: [record({ id: "clip-1", kind: "clip", startTimeSeconds: 4 })],
    });
    // Falls through to the point path, which is the honest reading of a record
    // with no Clip Range.
    expect(getMarkersForSegment(map, 2)[0]?.kind).toBe("point");
  });

  it("returns the shared empty array for unmarked segments", () => {
    const map = buildBookmarkMarkerMap({ segments, bookmarks: [] });
    expect(getMarkersForSegment(map, 1)).toBe(NO_MARKERS);
    expect(getMarkersForSegment(map, 2)).toBe(NO_MARKERS);
  });

  it("handles an empty transcript", () => {
    const map = buildBookmarkMarkerMap({
      segments: [],
      bookmarks: [record({ id: "point-1" })],
    });
    expect(map.size).toBe(0);
  });
});
