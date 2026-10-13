import {
  resolveLocalBookProgress,
  selectLocalContinueListeningIds,
  type LocalProgressInput,
  type StoredLocalProgress,
} from "./local-continue-listening";

const stored = (overrides: Partial<StoredLocalProgress> = {}): StoredLocalProgress => ({
  currentTime: 600,
  duration: 3600,
  isFinished: false,
  hideFromContinueListening: false,
  startedAt: 1_000,
  finishedAt: null,
  lastUpdate: 5_000,
  pendingIntentKind: null,
  pendingUpdatedAt: null,
  ...overrides,
});

const native = (
  overrides: Partial<NonNullable<LocalProgressInput["native"]>> = {},
): NonNullable<LocalProgressInput["native"]> => ({
  positionMs: 900_000,
  durationMs: 3_600_000,
  isFinished: false,
  sequence: 10,
  syncedThroughSequence: 10,
  committedAt: 8_000,
  ...overrides,
});

const resolve = (input: Partial<LocalProgressInput>) =>
  resolveLocalBookProgress({
    libraryItemId: "book-a",
    durationSeconds: 3600,
    stored: null,
    native: null,
    ...input,
  });

describe("resolveLocalBookProgress", () => {
  it("returns null when nothing is known about the book", () => {
    expect(resolve({})).toBeNull();
  });

  it("uses stored progress alone", () => {
    const progress = resolve({ stored: stored() });
    expect(progress?.currentTime).toBe(600);
    expect(progress?.lastUpdate).toBe(5_000);
  });

  it("prefers an unsynced native position even when it is behind", () => {
    const progress = resolve({
      stored: stored({ currentTime: 1200 }),
      native: native({ positionMs: 300_000, sequence: 12, syncedThroughSequence: 10 }),
    });
    expect(progress?.currentTime).toBe(300);
  });

  it("takes the furthest position once native is synced", () => {
    const progress = resolve({
      stored: stored({ currentTime: 1200 }),
      native: native({ positionMs: 300_000 }),
    });
    expect(progress?.currentTime).toBe(1200);
  });

  it("orders by the newer of native and stored timestamps", () => {
    expect(resolve({ stored: stored(), native: native({ committedAt: 9_000 }) })?.lastUpdate).toBe(
      9_000,
    );
  });

  it("honors a pending mark-unread newer than the native record", () => {
    const progress = resolve({
      stored: stored({ isFinished: true, pendingIntentKind: "mark_unread", pendingUpdatedAt: 9_000 }),
      native: native({ isFinished: true, committedAt: 8_000 }),
    });
    expect(progress?.currentTime).toBe(0);
    expect(progress?.isFinished).toBe(false);
  });

  it("treats a newer native position at the end as finished", () => {
    const progress = resolve({ native: native({ positionMs: 3_599_000, sequence: 11 }) });
    expect(progress?.isFinished).toBe(true);
  });
});

describe("selectLocalContinueListeningIds", () => {
  it("keeps in-progress, unhidden books, newest first", () => {
    const base = resolve({ stored: stored() })!;
    expect(
      selectLocalContinueListeningIds({
        old: { ...base, libraryItemId: "old", lastUpdate: 1 },
        recent: { ...base, libraryItemId: "recent", lastUpdate: 9 },
        finished: { ...base, libraryItemId: "finished", isFinished: true },
        hidden: { ...base, libraryItemId: "hidden", hideFromContinueListening: true },
        unstarted: { ...base, libraryItemId: "unstarted", currentTime: 0 },
      }),
    ).toEqual(["recent", "old"]);
  });
});
