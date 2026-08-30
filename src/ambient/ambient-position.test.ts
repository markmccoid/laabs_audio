import { ambientStore, wrapAmbientPositionMs } from "@/store/store-ambient";
import { ambientProgressStore } from "./ambient-progress-store";

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  }),
}));

const ambientListeners: ((event: unknown) => void)[] = [];
const nativeCalls: { seekTo: number[] } = { seekTo: [] };

jest.mock("react-native-audio-pro", () => ({
  AudioPro: {
    ambientPlay: jest.fn(),
    ambientStop: jest.fn(),
    ambientPause: jest.fn(),
    ambientResume: jest.fn(),
    ambientSetVolume: jest.fn(),
    ambientSeekTo: jest.fn((positionMs: number) => {
      nativeCalls.seekTo.push(positionMs);
    }),
    addAmbientListener: jest.fn((callback: (event: unknown) => void) => {
      ambientListeners.push(callback);
      return { remove: jest.fn() };
    }),
  },
  AudioProAmbientEventType: {
    AMBIENT_TRACK_ENDED: "AMBIENT_TRACK_ENDED",
    AMBIENT_ERROR: "AMBIENT_ERROR",
    AMBIENT_PROGRESS: "AMBIENT_PROGRESS",
  },
}));

jest.mock("@/player", () => ({
  playbackStore: {
    getState: () => ({ playbackState: "playing" }),
  },
}));

jest.mock("@/store/fileSystemAccess", () => ({
  AMBIENT_DOWNLOAD_DIRECTORY: "laabs-ambient",
  ensureAppDirectory: jest.fn(),
  isRelativeDocumentPath: (value?: string | null) => Boolean(value?.startsWith("laabs-ambient/")),
  resolveDocumentRelativePath: (value?: string | null) =>
    value ? `file:///documents/${value}` : null,
  toDocumentRelativePath: (value?: string | null) => value ?? null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ambientService } = require("./ambient-service") as typeof import("./ambient-service");

const TRACK_ID = "ambient-test";
const BOOK_ID = "book-1";
const FORTY_FIVE_MINUTES_MS = 45 * 60 * 1000;
/** Three hours and five minutes of elapsed listening = 5 minutes into loop 5. */
const THREE_HOURS_FIVE_MINUTES_MS = 3 * 60 * 60 * 1000 + 5 * 60 * 1000;

const emitProgress = (positionMs: number, durationMs: number) => {
  ambientListeners.forEach((listener) =>
    listener({ type: "AMBIENT_PROGRESS", payload: { position: positionMs, duration: durationMs } }),
  );
};

const setUpAttachedTrack = (durationMs?: number) => {
  const actions = ambientStore.getState().actions;
  actions.setEnabled(true);
  actions.addTrack({
    id: TRACK_ID,
    relativePath: `laabs-ambient/${TRACK_ID}.mp3`,
    fileName: "Rain.mp3",
    importedAt: 0,
    ...(durationMs ? { durationMs } : {}),
  });
  actions.attachTrackToBook(TRACK_ID, BOOK_ID);
};

describe("ambient position tracking", () => {
  beforeEach(() => {
    nativeCalls.seekTo = [];
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-29T12:00:00Z"));
    const actions = ambientStore.getState().actions;
    actions.clearActiveSession();
    actions.removeTrackFromAllBookAttachments(TRACK_ID);
    actions.removeTrack(TRACK_ID);
    ambientProgressStore.getState().actions.clear();
    ambientService.startNativeEventBridge();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("wraps a looping position instead of accumulating elapsed listening time", () => {
    expect(wrapAmbientPositionMs(THREE_HOURS_FIVE_MINUTES_MS, FORTY_FIVE_MINUTES_MS)).toBe(
      5 * 60 * 1000,
    );
    // Unknown loop length: nothing to wrap against, so the value is untouched.
    expect(wrapAmbientPositionMs(THREE_HOURS_FIVE_MINUTES_MS, 0)).toBe(
      THREE_HOURS_FIVE_MINUTES_MS,
    );
  });

  it("reports the player's position, not time elapsed since playback started", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);

    // Four loops of a 45 minute bed: the player is 10s into the file, even
    // though three hours of ambient audio have been heard.
    emitProgress(10_000, FORTY_FIVE_MINUTES_MS);
    jest.advanceTimersByTime(3 * 60 * 60 * 1000);

    expect(ambientService.getPositionSnapshotForBook(BOOK_ID)?.positionMs).toBeLessThan(
      FORTY_FIVE_MINUTES_MS,
    );
    expect(ambientService.getPositionSnapshotForBook(BOOK_ID)?.positionMs).toBeLessThan(13_000);
  });

  it("stops advancing when the native player goes quiet", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);
    emitProgress(20_000, FORTY_FIVE_MINUTES_MS);

    // Ticks stop (native error, teardown, suspension) — the position must not
    // keep marching on a wall clock.
    jest.advanceTimersByTime(60_000);

    expect(ambientService.getPositionSnapshotForBook(BOOK_ID)?.positionMs).toBeLessThanOrEqual(
      22_500,
    );
  });

  it("interpolates smoothly between native ticks", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);
    emitProgress(20_000, FORTY_FIVE_MINUTES_MS);

    jest.advanceTimersByTime(500);

    expect(ambientService.getPositionSnapshotForBook(BOOK_ID)?.positionMs).toBe(20_500);
  });

  it("learns the loop length from progress events and stores it on the track", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);

    emitProgress(1_000, FORTY_FIVE_MINUTES_MS);

    expect(ambientStore.getState().tracksById[TRACK_ID].durationMs).toBe(FORTY_FIVE_MINUTES_MS);
  });

  it("publishes each native tick to the runtime progress store", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);

    emitProgress(20_000, FORTY_FIVE_MINUTES_MS);

    expect(ambientProgressStore.getState()).toMatchObject({
      trackId: TRACK_ID,
      libraryItemId: BOOK_ID,
      positionMs: 20_000,
      durationMs: FORTY_FIVE_MINUTES_MS,
    });
  });

  it("publishes the tick position rather than the interpolated one", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);
    emitProgress(20_000, FORTY_FIVE_MINUTES_MS);

    jest.advanceTimersByTime(500);

    // Interpolation keeps a persisted position from lagging a tick behind, but
    // the displayed position must step once per second.
    expect(ambientService.getPositionSnapshotForBook(BOOK_ID)?.positionMs).toBe(20_500);
    expect(ambientProgressStore.getState().positionMs).toBe(20_000);
  });

  it("clears the published position when the session is torn down", () => {
    setUpAttachedTrack();
    ambientService.loadAttachedTrackForBook(BOOK_ID);
    emitProgress(20_000, FORTY_FIVE_MINUTES_MS);

    ambientService.saveProgressAndStopActiveTrack();

    expect(ambientProgressStore.getState().trackId).toBeNull();
    expect(ambientProgressStore.getState().libraryItemId).toBeNull();
  });

  it("seeks the native player and persists a user-picked position", () => {
    setUpAttachedTrack(FORTY_FIVE_MINUTES_MS);
    ambientService.loadAttachedTrackForBook(BOOK_ID);
    emitProgress(20_000, FORTY_FIVE_MINUTES_MS);

    ambientService.seekToPositionForBook(BOOK_ID, 90_000);

    expect(nativeCalls.seekTo).toEqual([90_000]);
    expect(ambientProgressStore.getState().positionMs).toBe(90_000);
    // Persisted outright: the sheet is usually open over a paused book, and the
    // periodic write-through only runs while playing.
    expect(
      ambientStore.getState().ambientPlaybackPreferenceByLibraryItemId[BOOK_ID].positionMs,
    ).toBe(90_000);
  });

  it("wraps a seek past the end of the loop", () => {
    setUpAttachedTrack(FORTY_FIVE_MINUTES_MS);
    ambientService.loadAttachedTrackForBook(BOOK_ID);

    ambientService.seekToPositionForBook(BOOK_ID, THREE_HOURS_FIVE_MINUTES_MS);

    expect(nativeCalls.seekTo).toEqual([5 * 60 * 1000]);
  });

  it("stores a seek made with no live session instead of dropping it", () => {
    // No session: the book is unloaded, or an error tore the player down.
    setUpAttachedTrack(FORTY_FIVE_MINUTES_MS);

    ambientService.seekToPositionForBook(BOOK_ID, 60_000);

    expect(nativeCalls.seekTo).toEqual([]);
    expect(
      ambientStore.getState().ambientPlaybackPreferenceByLibraryItemId[BOOK_ID].positionMs,
    ).toBe(60_000);
  });

  it("wraps an out-of-range stored resume position before seeking", () => {
    setUpAttachedTrack(FORTY_FIVE_MINUTES_MS);
    // A position written by an older build: three hours of elapsed listening.
    ambientStore
      .getState()
      .actions.setResumeStateForBook(BOOK_ID, TRACK_ID, THREE_HOURS_FIVE_MINUTES_MS);

    ambientService.loadAttachedTrackForBook(BOOK_ID);

    expect(nativeCalls.seekTo).toEqual([5 * 60 * 1000]);
  });
});
