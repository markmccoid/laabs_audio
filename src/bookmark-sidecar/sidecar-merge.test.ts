import { audioFingerprintsMatch, episodeDurationsMatch } from "./audio-fingerprint";
import type { SidecarBookmarkRecord } from "./sidecar-format";
import { mergeSidecarRecords, recordContentHash } from "./sidecar-merge";
import {
  bookRecordToSidecar,
  resolveSidecarEpisodeId,
  sidecarToBookRecord,
} from "./sidecar-record-adapters";
import type { LocalBookmarkRecord } from "@/store/device-books-store";

const record = (overrides: Partial<SidecarBookmarkRecord> = {}): SidecarBookmarkRecord => ({
  id: "bookmark_1",
  kind: "point",
  startTimeSeconds: 100,
  title: "Quote",
  note: null,
  createdAt: 1,
  updatedAt: 10,
  deletedAt: null,
  ...overrides,
});

const localRecord = (overrides: Partial<LocalBookmarkRecord> = {}): LocalBookmarkRecord => ({
  id: "bookmark_1",
  libraryItemId: "item_1",
  kind: "point",
  startTimeSeconds: 100,
  title: "Quote",
  note: null,
  createdAt: 1,
  updatedAt: 10,
  serverLink: { status: "matched", timeSeconds: 100, lastMatchedAt: 5 },
  ...overrides,
});

describe("mergeSidecarRecords", () => {
  it("keeps the record with the newer updatedAt", () => {
    const merged = mergeSidecarRecords(
      [record({ title: "Local", updatedAt: 20 })],
      [record({ title: "Remote", updatedAt: 15 })],
    );
    expect(merged).toEqual([record({ title: "Local", updatedAt: 20 })]);
  });

  it("lets a deletion win a tie", () => {
    const deleted = record({ deletedAt: 10, updatedAt: 10 });
    expect(mergeSidecarRecords([record()], [deleted])).toEqual([deleted]);
    expect(mergeSidecarRecords([deleted], [record()])).toEqual([deleted]);
  });

  it("does not let a stale copy resurrect a deleted record", () => {
    const deleted = record({ deletedAt: 30, updatedAt: 30 });
    expect(mergeSidecarRecords([record({ updatedAt: 20 })], [deleted])).toEqual([deleted]);
  });

  it("unions records that exist on only one side", () => {
    const merged = mergeSidecarRecords(
      [record({ id: "b", startTimeSeconds: 50 })],
      [record({ id: "a", startTimeSeconds: 200 })],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("bookRecordToSidecar", () => {
  it("keeps the last-synced updatedAt when only bookkeeping changed", () => {
    const synced = { hash: recordContentHash(record()), updatedAt: 10 };
    const bumped = localRecord({
      updatedAt: 99,
      serverLink: { status: "unmatched", timeSeconds: 100, lastMatchedAt: 5 },
    });
    expect(bookRecordToSidecar(bumped, synced).updatedAt).toBe(10);
  });

  it("uses the local updatedAt for a real edit", () => {
    const synced = { hash: recordContentHash(record()), updatedAt: 10 };
    expect(bookRecordToSidecar(localRecord({ title: "Edited", updatedAt: 99 }), synced).updatedAt).toBe(
      99,
    );
  });
});

describe("sidecarToBookRecord", () => {
  it("keeps the server link when the start is unchanged", () => {
    const existing = localRecord();
    expect(sidecarToBookRecord(record({ title: "New" }), "item_1", existing).serverLink).toBe(
      existing.serverLink,
    );
  });

  it("arrives Unmatched when the start moved or the record is new", () => {
    expect(sidecarToBookRecord(record({ startTimeSeconds: 300 }), "item_1", localRecord()).serverLink)
      .toEqual({ status: "unmatched", timeSeconds: 300, lastMatchedAt: null });
    expect(sidecarToBookRecord(record(), "item_2", null).libraryItemId).toBe("item_2");
  });
});

describe("Audio Fingerprint", () => {
  it("tolerates small duration differences but not a different track count", () => {
    const stored = { durationSeconds: 1000, trackCount: 3 };
    expect(audioFingerprintsMatch(stored, { durationSeconds: 1002, trackCount: 3 })).toBe(true);
    expect(audioFingerprintsMatch(stored, { durationSeconds: 1010, trackCount: 3 })).toBe(false);
    expect(audioFingerprintsMatch(stored, { durationSeconds: 1000, trackCount: 4 })).toBe(false);
    expect(audioFingerprintsMatch(null, stored)).toBe(true);
    expect(episodeDurationsMatch(60, 70)).toBe(false);
    expect(episodeDurationsMatch(null, 70)).toBe(true);
  });
});

describe("resolveSidecarEpisodeId", () => {
  const episodes = [
    { episodeId: "new_ep", audioRelPath: "Episode 12.mp3", durationSeconds: 60 },
    { episodeId: "other", audioRelPath: "Episode 13.mp3", durationSeconds: 60 },
  ];

  it("prefers the audio file path over a regenerated episode id", () => {
    expect(
      resolveSidecarEpisodeId(
        { episodeId: "old_ep", audioRelPath: "Episode 12.mp3" },
        episodes,
      ),
    ).toBe("new_ep");
  });

  it("falls back to the episode id, then gives up", () => {
    expect(
      resolveSidecarEpisodeId({ episodeId: "other", audioRelPath: null }, episodes),
    ).toBe("other");
    expect(
      resolveSidecarEpisodeId({ episodeId: "gone", audioRelPath: "x.mp3" }, episodes),
    ).toBeNull();
  });
});
