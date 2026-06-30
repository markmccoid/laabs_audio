export type AutoRewindRule = {
  thresholdMinutes: number;
  rewindSeconds: number;
};

export type AutoRewindChapter = {
  startMs: number;
  endMs: number;
};

export type AutoRewindDecision =
  | { status: "disabled" }
  | { status: "no_interruption" }
  | { status: "finished" }
  | { status: "no_matching_rule"; interruptionMs: number }
  | {
      status: "applied";
      interruptionMs: number;
      thresholdMinutes: number;
      rewindSeconds: number;
      fromPositionMs: number;
      toPositionMs: number;
      chapterFloorMs: number | null;
    };

export const MAX_AUTO_REWIND_RULES = 10;
export const MIN_AUTO_REWIND_THRESHOLD_MINUTES = 0;
export const MAX_AUTO_REWIND_THRESHOLD_MINUTES = 2 * 60;
export const MIN_AUTO_REWIND_SECONDS = 0;
export const MAX_AUTO_REWIND_SECONDS = 5 * 60;
export const DEFAULT_AUTO_REWIND_RULES: AutoRewindRule[] = [
  { thresholdMinutes: 0, rewindSeconds: 1 },
  { thresholdMinutes: 10, rewindSeconds: 15 },
  { thresholdMinutes: 60, rewindSeconds: 30 },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(value)));

export const normalizeAutoRewindRule = (rule: AutoRewindRule): AutoRewindRule => ({
  thresholdMinutes: clamp(
    rule.thresholdMinutes,
    MIN_AUTO_REWIND_THRESHOLD_MINUTES,
    MAX_AUTO_REWIND_THRESHOLD_MINUTES,
  ),
  rewindSeconds: clamp(rule.rewindSeconds, MIN_AUTO_REWIND_SECONDS, MAX_AUTO_REWIND_SECONDS),
});

export const normalizeAutoRewindRules = (
  rules: AutoRewindRule[] | null | undefined,
): AutoRewindRule[] => {
  const byThreshold = new Map<number, AutoRewindRule>();

  (rules ?? []).forEach((rule) => {
    if (
      !rule ||
      typeof rule.thresholdMinutes !== "number" ||
      typeof rule.rewindSeconds !== "number"
    ) {
      return;
    }
    const normalized = normalizeAutoRewindRule(rule);
    byThreshold.set(normalized.thresholdMinutes, normalized);
  });

  return [...byThreshold.values()]
    .sort((a, b) => a.thresholdMinutes - b.thresholdMinutes)
    .slice(0, MAX_AUTO_REWIND_RULES);
};

export const hasDuplicateAutoRewindThresholds = (rules: AutoRewindRule[]) => {
  const seen = new Set<number>();
  return rules.some((rule) => {
    const threshold = normalizeAutoRewindRule(rule).thresholdMinutes;
    if (seen.has(threshold)) return true;
    seen.add(threshold);
    return false;
  });
};

export const selectAutoRewindRule = (
  rules: AutoRewindRule[],
  interruptionMs: number,
): AutoRewindRule | null => {
  const normalizedRules = normalizeAutoRewindRules(rules);
  const interruptionMinutes = Math.max(0, interruptionMs) / 60000;
  return normalizedRules.reduce<AutoRewindRule | null>((selected, rule) => {
    if (interruptionMinutes < rule.thresholdMinutes) return selected;
    if (!selected || rule.thresholdMinutes >= selected.thresholdMinutes) return rule;
    return selected;
  }, null);
};

const findChapterForAutoRewind = (
  chapters: AutoRewindChapter[],
  positionMs: number,
): AutoRewindChapter | null => {
  if (!chapters.length) return null;
  const found = chapters.find(
    (chapter) => positionMs >= chapter.startMs && positionMs < chapter.endMs,
  );
  if (found) return found;
  if (positionMs < chapters[0].startMs) return chapters[0];
  return chapters[chapters.length - 1];
};

export const resolveAutoRewindDecision = (payload: {
  enabled: boolean;
  rules: AutoRewindRule[];
  interruptionStartedAtMs: number | null | undefined;
  nowMs: number;
  positionMs: number;
  durationMs: number;
  chapters?: AutoRewindChapter[];
  limitToChapter: boolean;
  isFinished: boolean;
}): AutoRewindDecision => {
  if (!payload.enabled) {
    return { status: "disabled" };
  }
  if (
    typeof payload.interruptionStartedAtMs !== "number" ||
    !Number.isFinite(payload.interruptionStartedAtMs) ||
    payload.interruptionStartedAtMs <= 0
  ) {
    return { status: "no_interruption" };
  }
  if (payload.isFinished) {
    return { status: "finished" };
  }

  const interruptionMs = Math.max(0, payload.nowMs - payload.interruptionStartedAtMs);
  const matchingRule = selectAutoRewindRule(payload.rules, interruptionMs);
  if (!matchingRule) {
    return { status: "no_matching_rule", interruptionMs };
  }

  const fromPositionMs = Math.max(0, Math.round(payload.positionMs));
  const maxPositionMs = payload.durationMs > 0 ? Math.max(0, Math.round(payload.durationMs)) : fromPositionMs;
  const chapter = payload.limitToChapter
    ? findChapterForAutoRewind(payload.chapters ?? [], fromPositionMs)
    : null;
  const chapterFloorMs = chapter ? Math.max(0, Math.round(chapter.startMs)) : null;
  const floorMs = chapterFloorMs ?? 0;
  const rawTargetMs = fromPositionMs - matchingRule.rewindSeconds * 1000;
  const toPositionMs = Math.max(floorMs, Math.min(maxPositionMs, Math.max(0, rawTargetMs)));

  return {
    status: "applied",
    interruptionMs,
    thresholdMinutes: matchingRule.thresholdMinutes,
    rewindSeconds: matchingRule.rewindSeconds,
    fromPositionMs,
    toPositionMs,
    chapterFloorMs,
  };
};
