import {
  isPodcastLibraryMediaType,
  resolveSeriesIndexReadiness,
} from "../series-index-readiness";

describe("resolveSeriesIndexReadiness", () => {
  it("is ready when refresh completed even without a remembered index", () => {
    expect(
      resolveSeriesIndexReadiness({
        refreshOutcome: "completed",
        hasRememberedIndex: false,
      }),
    ).toEqual({ status: "ready", reason: "refresh_completed" });
  });

  it("is ready when refresh completed for an empty remembered index", () => {
    expect(
      resolveSeriesIndexReadiness({
        refreshOutcome: "completed",
        hasRememberedIndex: true,
      }),
    ).toEqual({ status: "ready", reason: "refresh_completed" });
  });

  it("is ready from remembered index when refresh fails", () => {
    expect(
      resolveSeriesIndexReadiness({
        refreshOutcome: "failed",
        hasRememberedIndex: true,
      }),
    ).toEqual({ status: "ready", reason: "remembered_index" });
  });

  it("is not ready when refresh fails and there is no remembered index", () => {
    expect(
      resolveSeriesIndexReadiness({
        refreshOutcome: "failed",
        hasRememberedIndex: false,
      }),
    ).toEqual({ status: "not_ready", reason: "refresh_failed_without_index" });
  });
});

describe("isPodcastLibraryMediaType", () => {
  it("detects podcast media types case-insensitively", () => {
    expect(isPodcastLibraryMediaType("podcast")).toBe(true);
    expect(isPodcastLibraryMediaType("Podcast")).toBe(true);
    expect(isPodcastLibraryMediaType("book")).toBe(false);
    expect(isPodcastLibraryMediaType(null)).toBe(false);
  });
});
