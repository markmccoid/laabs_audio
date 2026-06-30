import {
  DEFAULT_AUTO_REWIND_RULES,
  hasDuplicateAutoRewindThresholds,
  normalizeAutoRewindRules,
  resolveAutoRewindDecision,
  selectAutoRewindRule,
} from "./auto-rewind";

describe("auto rewind helpers", () => {
  it("normalizes rules by sorting, clamping, and de-duplicating thresholds", () => {
    expect(
      normalizeAutoRewindRules([
        { thresholdMinutes: 60, rewindSeconds: 300 },
        { thresholdMinutes: -5, rewindSeconds: 0 },
        { thresholdMinutes: 60, rewindSeconds: 15 },
      ]),
    ).toEqual([
      { thresholdMinutes: 0, rewindSeconds: 0 },
      { thresholdMinutes: 60, rewindSeconds: 15 },
    ]);
  });

  it("clamps thresholds to two hours and rewind amounts to five minutes", () => {
    expect(normalizeAutoRewindRules([{ thresholdMinutes: 500, rewindSeconds: 500 }])).toEqual([
      { thresholdMinutes: 120, rewindSeconds: 300 },
    ]);
  });

  it("detects duplicate thresholds after normalization", () => {
    expect(
      hasDuplicateAutoRewindThresholds([
        { thresholdMinutes: 10.2, rewindSeconds: 15 },
        { thresholdMinutes: 10.4, rewindSeconds: 30 },
      ]),
    ).toBe(true);
  });

  it("selects the largest matching threshold", () => {
    expect(selectAutoRewindRule(DEFAULT_AUTO_REWIND_RULES, 75 * 60000)).toEqual({
      thresholdMinutes: 60,
      rewindSeconds: 30,
    });
  });

  it("lets a zero-minute rule match short interruptions", () => {
    const decision = resolveAutoRewindDecision({
      enabled: true,
      rules: DEFAULT_AUTO_REWIND_RULES,
      interruptionStartedAtMs: 9_000,
      nowMs: 10_000,
      positionMs: 30_000,
      durationMs: 120_000,
      limitToChapter: true,
      isFinished: false,
    });

    expect(decision).toMatchObject({
      status: "applied",
      thresholdMinutes: 0,
      rewindSeconds: 1,
      fromPositionMs: 30_000,
      toPositionMs: 29_000,
    });
  });

  it("does not cross the current chapter floor when chapter limiting is enabled", () => {
    const decision = resolveAutoRewindDecision({
      enabled: true,
      rules: [{ thresholdMinutes: 0, rewindSeconds: 10 }],
      interruptionStartedAtMs: 1,
      nowMs: 20_000,
      positionMs: 65_000,
      durationMs: 180_000,
      chapters: [
        { startMs: 0, endMs: 60_000 },
        { startMs: 60_000, endMs: 120_000 },
      ],
      limitToChapter: true,
      isFinished: false,
    });

    expect(decision).toMatchObject({
      status: "applied",
      fromPositionMs: 65_000,
      toPositionMs: 60_000,
      chapterFloorMs: 60_000,
    });
  });

  it("returns no matching rule and leaves consumption to the caller", () => {
    expect(
      resolveAutoRewindDecision({
        enabled: true,
        rules: [{ thresholdMinutes: 10, rewindSeconds: 15 }],
        interruptionStartedAtMs: 1,
        nowMs: 5 * 60000,
        positionMs: 60_000,
        durationMs: 120_000,
        limitToChapter: false,
        isFinished: false,
      }),
    ).toMatchObject({ status: "no_matching_rule" });
  });

  it("does not apply to finished books", () => {
    expect(
      resolveAutoRewindDecision({
        enabled: true,
        rules: DEFAULT_AUTO_REWIND_RULES,
        interruptionStartedAtMs: 1,
        nowMs: 60_000,
        positionMs: 120_000,
        durationMs: 120_000,
        limitToChapter: false,
        isFinished: true,
      }),
    ).toEqual({ status: "finished" });
  });
});
