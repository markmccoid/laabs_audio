/**
 * Pure Podcast Series Index readiness decision (ADR 0025).
 * Injectable refresh/remembered checks live in the experience facade.
 */

export type SeriesIndexRefreshOutcome = "completed" | "failed";

export type SeriesIndexReadinessInput = {
  refreshOutcome: SeriesIndexRefreshOutcome;
  /** True when a prior completed series-index refresh exists for this User+Library (including empty). */
  hasRememberedIndex: boolean;
};

export type SeriesIndexReadinessResult =
  | { status: "ready"; reason: "refresh_completed" | "remembered_index" }
  | { status: "not_ready"; reason: "refresh_failed_without_index" };

export const resolveSeriesIndexReadiness = (
  input: SeriesIndexReadinessInput,
): SeriesIndexReadinessResult => {
  if (input.refreshOutcome === "completed") {
    return { status: "ready", reason: "refresh_completed" };
  }
  if (input.hasRememberedIndex) {
    return { status: "ready", reason: "remembered_index" };
  }
  return { status: "not_ready", reason: "refresh_failed_without_index" };
};

export const isPodcastLibraryMediaType = (mediaType: string | null | undefined) =>
  (mediaType ?? "").trim().toLowerCase() === "podcast";
