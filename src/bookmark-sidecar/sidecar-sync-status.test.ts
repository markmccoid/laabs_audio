import { buildSidecarSyncRows, type SidecarSyncStatusInput } from "./sidecar-sync-status";

const input = (overrides: Partial<SidecarSyncStatusInput> = {}): SidecarSyncStatusInput => ({
  bookItemIds: [],
  podcastItemIds: [],
  dirtyItemIds: [],
  errors: {},
  scopeStates: {},
  titleFor: (id) => ({ a: "Alpha", b: "Bravo", c: "Charlie", p: "Pod" })[id] ?? null,
  ...overrides,
});

const fingerprintState = (status: "mismatch" | "paused") => ({
  status,
  storedFingerprint: null,
  currentFingerprint: null,
  remoteRecordCount: 0,
  localRecordCount: 0,
});

describe("buildSidecarSyncRows", () => {
  it("counts bookmarks per item and marks clean items synced", () => {
    const rows = buildSidecarSyncRows(input({ bookItemIds: ["a", "a", "b"], podcastItemIds: ["p"] }));
    expect(rows.map(({ libraryItemId, bookmarkCount, status, media }) => [libraryItemId, bookmarkCount, status, media]))
      .toEqual([
        ["a", 2, "synced", "book"],
        ["b", 1, "synced", "book"],
        ["p", 1, "synced", "podcast"],
      ]);
  });

  it("orders failed, then needs-attention, then waiting, then synced", () => {
    const rows = buildSidecarSyncRows(
      input({
        bookItemIds: ["a", "b", "c", "p"],
        dirtyItemIds: ["a", "b"],
        errors: { b: "ENOTSUP" },
        scopeStates: { "c::ep1": fingerprintState("paused"), "c::ep2": fingerprintState("mismatch") },
      }),
    );
    expect(rows.map((row) => [row.libraryItemId, row.status])).toEqual([
      ["b", "error"],
      ["c", "attention"],
      ["a", "waiting"],
      ["p", "synced"],
    ]);
    expect(rows[0].detail).toBe("ENOTSUP");
    expect(rows[1].detail).toMatch(/audio has changed/);
  });

  it("lists dirty items with no bookmarks left, and sorts unknown titles last", () => {
    const rows = buildSidecarSyncRows(input({ bookItemIds: ["zzz", "a"], dirtyItemIds: ["gone", "a"] }));
    expect(rows.map((row) => [row.libraryItemId, row.title, row.bookmarkCount, row.status])).toEqual([
      ["a", "Alpha", 1, "waiting"],
      ["gone", null, 0, "waiting"],
      ["zzz", null, 1, "synced"],
    ]);
  });
});
