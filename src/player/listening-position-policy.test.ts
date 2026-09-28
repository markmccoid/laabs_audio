import { isStaleListeningPositionEvent, resolveConfirmedLoadPosition, resolveNativeResumePosition } from "./listening-position-policy";

describe("Listening Position ordering", () => {
  it("keeps a recovered native 45:00 rather than the requested 3:00", () => {
    expect(resolveConfirmedLoadPosition({ positionMs: 2_700_000 }, 180_000)).toBe(2_700_000);
  });
  it("accepts a confirmed intentional rewind", () => {
    expect(resolveConfirmedLoadPosition({ positionMs: 180_000 }, 2_700_000)).toBe(180_000);
    expect(isStaleListeningPositionEvent({ playbackGeneration: 4, positionRevision: 2, positionSequence: 20 }, { playbackGeneration: 4, positionRevision: 1, positionSequence: 21 })).toBe(true);
  });
  it("rejects an older player even if its position sequence is larger", () => {
    expect(isStaleListeningPositionEvent({ playbackGeneration: 5 }, { playbackGeneration: 4, positionSequence: 100 })).toBe(true);
  });
  it("resumes unsynced native evidence even behind old server progress", () => {
    expect(resolveNativeResumePosition({ fallbackPositionMs: 2_700_000, nativePositionMs: 180_000, nativeSequence: 9, syncedThroughSequence: 8 })).toBe(180_000);
  });
  it("lets explicit pending unread supersede an old native checkpoint", () => {
    expect(resolveNativeResumePosition({ fallbackPositionMs: 2_700_000, nativePositionMs: 2_700_000, nativeSequence: 9, syncedThroughSequence: 8, pendingExplicitPositionMs: 0 })).toBe(0);
  });
  it("allows later server advancement after local progress is synced", () => {
    expect(resolveNativeResumePosition({ fallbackPositionMs: 2_800_000, nativePositionMs: 2_700_000, nativeSequence: 9, syncedThroughSequence: 9 })).toBe(2_800_000);
  });
});
