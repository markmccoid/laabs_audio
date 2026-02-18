import { AppState, type AppStateStatus } from "react-native";
import { playbackApi } from "../api/playback-api";
import { sessionsApi } from "../api/sessions-api";
import { settingsStore } from "../store/settings-store";
import {
  booksStore,
  DEFAULT_BOOK_PLAYBACK_RATE,
  selectBookPayload,
} from "../store/store-books";
import { createAudioEngine } from "./audio-engine";
import { buildChapterIndex, findChapterForPosition, findTrackForPosition } from "./chapters";
import { playbackStore } from "./playback-store";
import type { PlaybackStoreState } from "./playback-store";
import { buildPlaybackQueue } from "./queue";
import type { PitchCorrectionQuality, PlaybackQueueItem } from "./types";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_LISTEN_DELTA_MS = 5000;
const DEBUG_PLAYBACK_EVENTS = false;
const CHAPTER_RESTART_THRESHOLD_MS = 3000;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2.0;

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const msToSeconds = (value: number) => Math.max(0, Math.floor(value / 1000));
const clampPlaybackRate = (rate: number) =>
  Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate));

// Orchestrates playback between the UI, store, and audio engine.
class PlayerService {
  private engine = createAudioEngine();
  private lastTrackedPositionMs = 0;
  private listenedMs = 0;
  private lastSyncAt = 0;
  private lastIsPlaying = false;
  private appState: AppStateStatus = "active";
  private appStateSubscription: { remove: () => void } | null = null;

  init() {
    if (this.appStateSubscription) return;
    // App state drives background sync; engine events drive store updates.
    this.appStateSubscription = AppState.addEventListener("change", this.handleAppState);
    this.engine.setEvents({
      onEnded: () => {
        void this.handleTrackEnded();
      },
      onError: (error) => {
        playbackStore.getState().actions.setError(error.message);
        this.logDebug(`engine error: ${error.message}`);
      },
      onStatus: (status) => {
        void this.handleStatus(status);
      },
    });
  }

  destroy() {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }

  async loadBook(itemId: string, options?: { autoPlay?: boolean }) {
    playbackStore.getState().actions.setPlaybackState("loading");
    playbackStore.getState().actions.setError(null);

    if (__DEV__) {
      console.log("[player-service] loadBook:start", { itemId });
    }

    try {
      // Fetch session metadata, build queue + chapters, and resume if applicable.
      const session = await playbackApi.getPlayInfo(itemId);
      console.log("SessionInfo for", session.bookId, session.displayTitle);
      const { queue, durationMs } = buildPlaybackQueue(session);
      const chapterIndex = buildChapterIndex(session.chapters, session.audioTracks);

      // Ensure the streamed book is indexed in the local books store
      booksStore.getState().actions.upsertBookFromLibraryItem(session.libraryItem, {
        isStreamed: true,
        lastOpenedAt: Date.now(),
      });

      // Local progress is the source of truth for resume position in book views.
      const storedBookPayload = selectBookPayload(booksStore.getState(), itemId);
      const localBookProgressMs = storedBookPayload.progress?.currentPosition;
      const storedBookRate = storedBookPayload.progress?.playbackRate ?? DEFAULT_BOOK_PLAYBACK_RATE;
      // Fallback to persisted playback position for safety when no local progress exists.
      const persisted = playbackStore.getState();
      const persistedPositionMs = persisted.bookId === itemId ? persisted.positionMs : 0;
      const resumePositionMs = localBookProgressMs ?? persistedPositionMs;

      this.listenedMs = 0;
      this.lastSyncAt = 0;
      this.lastTrackedPositionMs = 0;
      this.lastIsPlaying = false;

      playbackStore.getState().actions.setSession({
        bookId: session.libraryItem.id,
        sessionId: session.id,
        queue,
        durationMs,
        chapterIndex,
      });
      playbackStore.getState().actions.setRate(storedBookRate);

      const targetTrack = findTrackForPosition(queue, resumePositionMs) ?? queue[0];
      const targetIndex = queue.indexOf(targetTrack);
      const trackPositionMs = Math.max(0, resumePositionMs - targetTrack.startOffsetMs);

      await this.loadTrack(targetIndex, { initialPositionMs: trackPositionMs });
      this.logSnapshot("after loadBook");

      if (options?.autoPlay) {
        await this.play();
      } else {
        playbackStore.getState().actions.setPlaybackState("ready");
      }
    } catch (error) {
      if (__DEV__) {
        console.log("[player-service] loadBook:error", { itemId, error });
      }
      const message = error instanceof Error ? error.message : "Unable to load book";
      const hasQueue = playbackStore.getState().queue.length > 0;
      playbackStore.getState().actions.setPlaybackState(hasQueue ? "ready" : "error");
      playbackStore.getState().actions.setError(message);
      throw error;
    }
  }

  async loadLocalFile(payload: {
    bookId: string;
    title: string;
    author: string;
    uri?: string;
    sourceModule?: number;
    durationMs?: number;
    autoPlay?: boolean;
  }) {
    this.logDebug(
      `loadLocalFile: ${payload.bookId} sourceModule=${typeof payload.sourceModule} uri=${payload.uri ?? "none"}`,
    );
    if (!payload.uri && typeof payload.sourceModule !== "number") {
      throw new Error("loadLocalFile requires a uri or sourceModule");
    }
    const durationMs = payload.durationMs ?? 0;
    // Local-only queue with a single track (used for development/testing).
    const queue: PlaybackQueueItem[] = [
      {
        id: `${payload.bookId}-local`,
        bookId: payload.bookId,
        sessionId: "local",
        trackIndex: 0,
        title: payload.title,
        author: payload.author,
        durationMs,
        startOffsetMs: 0,
        source: {
          uri: payload.uri,
          sourceModule: payload.sourceModule,
          isLocal: true,
        },
      },
    ];

    playbackStore.getState().actions.setSession({
      bookId: payload.bookId,
      sessionId: "local",
      queue,
      durationMs,
      chapterIndex: [],
    });
    const storedBookRate =
      selectBookPayload(booksStore.getState(), payload.bookId).progress?.playbackRate ??
      DEFAULT_BOOK_PLAYBACK_RATE;
    playbackStore.getState().actions.setRate(storedBookRate);

    this.listenedMs = 0;
    this.lastSyncAt = 0;
    this.lastTrackedPositionMs = 0;
    this.lastIsPlaying = false;

    await this.loadTrack(0, { initialPositionMs: 0 });
    this.logSnapshot("after loadLocalFile");

    if (payload.autoPlay) {
      await this.play();
    } else {
      playbackStore.getState().actions.setPlaybackState("ready");
    }
  }

  async play() {
    this.logDebug("play");
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    try {
      await this.engine.play();

      try {
        await this.engine.waitForPlaying({ timeoutMs: 15000 });
      } catch {
        // Some devices can settle in PAUSED/STOPPED briefly after load.
        // Retry play once, then wait again before surfacing an error.
        await this.engine.play();
        await this.engine.waitForPlaying({ timeoutMs: 15000 });
      }

      this.logSnapshot("after play");
      playbackStore.getState().actions.setPlaybackState("playing");
      playbackStore.getState().actions.setError(null);
      this.lastIsPlaying = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start playback";
      const currentState = playbackStore.getState();
      if (currentState.queue.length > 0) {
        playbackStore.getState().actions.setPlaybackState("ready");
      } else {
        playbackStore.getState().actions.setPlaybackState("error");
      }
      playbackStore.getState().actions.setError(message);
      this.lastIsPlaying = false;
    }
  }

  async pause() {
    this.logDebug("pause");
    await this.engine.pause();
    this.logSnapshot("after pause");
    playbackStore.getState().actions.setPlaybackState("paused");
    this.lastIsPlaying = false;
    await this.syncProgress("pause");
  }

  async stop() {
    await this.engine.pause();
    await this.engine.unload();
    playbackStore.getState().actions.reset();
    this.listenedMs = 0;
    this.lastSyncAt = 0;
    this.lastTrackedPositionMs = 0;
    this.lastIsPlaying = false;
  }

  async togglePlayPause() {
    const state = playbackStore.getState();
    if (state.playbackState === "playing") {
      await this.pause();
      return;
    }
    if (state.playbackState === "loading") return;
    if (!state.queue.length) {
      if (state.bookId) {
        await this.loadBook(state.bookId, { autoPlay: true });
      }
      return;
    }
    await this.play();
  }

  async seekTo(positionMs: number) {
    const state = playbackStore.getState();
    if (!state.queue.length) return;
    this.logDebug(`seekTo: ${positionMs}`);

    const maxPosition = state.durationMs > 0 ? state.durationMs : positionMs;
    const boundedPosition = Math.max(0, Math.min(positionMs, maxPosition));
    const targetTrack = findTrackForPosition(state.queue, boundedPosition);
    if (!targetTrack) return;

    const targetIndex = state.queue.indexOf(targetTrack);
    const trackPositionMs = Math.max(0, boundedPosition - targetTrack.startOffsetMs);
    const isPlaying = state.playbackState === "playing";

    if (targetIndex !== state.currentTrackIndex) {
      await this.loadTrack(targetIndex, {
        initialPositionMs: trackPositionMs,
        autoPlay: isPlaying,
      });
    } else {
      await this.engine.seek(trackPositionMs);
    }

    playbackStore.getState().actions.setPosition({
      positionMs: boundedPosition,
      trackPositionMs,
    });
    const chapterAtPosition = findChapterForPosition(state.chapterIndex, boundedPosition);
    playbackStore.getState().actions.setCurrentChapter(chapterAtPosition?.id ?? null);
    this.lastTrackedPositionMs = boundedPosition;
  }

  async skipBy(seconds: number) {
    const state = playbackStore.getState();
    if (!state.queue.length) return;
    await this.seekTo(state.positionMs + secondsToMs(seconds));
  }

  async setRate(rate: number) {
    const normalizedRate = clampPlaybackRate(rate);
    this.logDebug(`setRate: ${normalizedRate}`);
    const state = playbackStore.getState();
    playbackStore.getState().actions.setRate(normalizedRate);
    if (state.bookId) {
      booksStore.getState().actions.setBookPlaybackRate(state.bookId, normalizedRate);
    }
    await this.engine.setRate(normalizedRate, settingsStore.getState().pitchCorrectionQuality);
  }

  async setPitchCorrectionQuality(quality: PitchCorrectionQuality) {
    this.logDebug(`setPitchCorrectionQuality: ${quality}`);
    settingsStore.getState().actions.setPitchCorrectionQuality(quality);
    await this.engine.setRate(playbackStore.getState().rate, quality);
  }

  async nextTrack() {
    const state = playbackStore.getState();
    const nextIndex = state.currentTrackIndex + 1;
    if (nextIndex >= state.queue.length) {
      playbackStore.getState().actions.setPlaybackState("ended");
      await this.syncProgress("end");
      return;
    }

    const shouldAutoPlay = state.playbackState === "playing";
    await this.loadTrack(nextIndex, { initialPositionMs: 0, autoPlay: shouldAutoPlay });
  }

  async previousTrack() {
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    if (state.trackPositionMs > 3000) {
      await this.seekTo(state.queue[state.currentTrackIndex].startOffsetMs);
      return;
    }

    const prevIndex = Math.max(0, state.currentTrackIndex - 1);
    const shouldAutoPlay = state.playbackState === "playing";
    await this.loadTrack(prevIndex, { initialPositionMs: 0, autoPlay: shouldAutoPlay });
  }

  async jumpToChapter(chapterId: number) {
    const state = playbackStore.getState();
    const chapter = state.chapterIndex.find((item) => item.id === chapterId);
    if (!chapter) return;
    await this.seekTo(chapter.startMs);
  }

  async nextChapter() {
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    if (!state.chapterIndex.length) {
      await this.nextTrack();
      return;
    }

    const currentChapter = this.resolveCurrentChapter(state);
    if (!currentChapter) return;

    const currentIndex = state.chapterIndex.findIndex(
      (chapter) => chapter.id === currentChapter.id,
    );
    const nextChapter = currentIndex >= 0 ? state.chapterIndex[currentIndex + 1] : null;
    if (!nextChapter) return;

    await this.seekTo(nextChapter.startMs);
  }

  async previousChapter() {
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    if (!state.chapterIndex.length) {
      await this.previousTrack();
      return;
    }

    const currentChapter = this.resolveCurrentChapter(state);
    if (!currentChapter) return;

    const currentIndex = state.chapterIndex.findIndex(
      (chapter) => chapter.id === currentChapter.id,
    );

    const shouldRestartCurrent =
      state.positionMs - currentChapter.startMs > CHAPTER_RESTART_THRESHOLD_MS;
    if (shouldRestartCurrent || currentIndex <= 0) {
      await this.seekTo(currentChapter.startMs);
      return;
    }

    const prevChapter = state.chapterIndex[currentIndex - 1];
    if (!prevChapter) return;
    await this.seekTo(prevChapter.startMs);
  }

  private async loadTrack(
    index: number,
    options?: { initialPositionMs?: number; autoPlay?: boolean },
  ) {
    const state = playbackStore.getState();
    const track = state.queue[index];
    if (!track) {
      throw new Error("Track not found");
    }
    this.logDebug(
      `loadTrack: index=${index} startOffset=${track.startOffsetMs} source=${
        track.source.uri ?? track.source.sourceModule ?? "unknown"
      }`,
    );

    await this.engine.load(track, {
      initialPositionMs: options?.initialPositionMs ?? 0,
      rate: state.rate,
      pitchCorrectionQuality: settingsStore.getState().pitchCorrectionQuality,
    });

    playbackStore.getState().actions.setCurrentTrack(index, track.durationMs);

    const bookPositionMs = track.startOffsetMs + (options?.initialPositionMs ?? 0);
    playbackStore.getState().actions.setPosition({
      positionMs: bookPositionMs,
      trackPositionMs: options?.initialPositionMs ?? 0,
    });
    const chapterAtPosition = findChapterForPosition(state.chapterIndex, bookPositionMs);
    playbackStore.getState().actions.setCurrentChapter(chapterAtPosition?.id ?? null);

    this.lastTrackedPositionMs = bookPositionMs;

    if (options?.autoPlay) {
      await this.play();
    }
  }

  private resolveCurrentChapter(state: PlaybackStoreState) {
    if (!state.chapterIndex.length) return null;
    // Position is the most reliable source after seek operations.
    return findChapterForPosition(state.chapterIndex, state.positionMs);
  }

  private handleAppState = (nextState: AppStateStatus) => {
    const wasActive = this.appState === "active";
    this.appState = nextState;
    if (wasActive && nextState !== "active") {
      void this.syncProgress("background");
    }
  };

  private async handleStatus(status: {
    positionMs: number;
    durationMs: number;
    isPlaying: boolean;
    didJustFinish: boolean;
  }) {
    // Store the latest engine status only when debug logging is enabled.
    const debugStatus = DEBUG_PLAYBACK_EVENTS
      ? {
          ...status,
          updatedAt: Date.now(),
        }
      : null;

    const state = playbackStore.getState();
    if (!state.queue.length) return;
    const currentTrack = state.queue[state.currentTrackIndex];
    if (!currentTrack) return;

    const trackPositionMs = Math.max(0, status.positionMs);
    const positionMs = currentTrack.startOffsetMs + trackPositionMs;
    const updates: Parameters<PlaybackStoreState["actions"]["applyStatusUpdate"]>[0] = {
      positionMs,
      trackPositionMs,
    };

    // Keep store playbackState aligned with engine state.
    if (status.isPlaying && state.playbackState !== "playing") {
      updates.playbackState = "playing";
    } else if (!status.isPlaying && state.playbackState === "playing") {
      updates.playbackState = "paused";
    }

    if (status.durationMs > 0 && status.durationMs !== state.trackDurationMs) {
      updates.trackDurationMs = status.durationMs;
    }

    // Chapter mapping is based on absolute book time.
    const chapter = findChapterForPosition(state.chapterIndex, positionMs);
    if (chapter?.id !== state.currentChapterId) {
      updates.currentChapterId = chapter?.id ?? null;
    }

    if (debugStatus) {
      updates.debugStatus = debugStatus;
    }

    playbackStore.getState().actions.applyStatusUpdate(updates);

    // Accumulate listening time for sync (ignore large jumps).
    if (status.isPlaying) {
      const delta = positionMs - this.lastTrackedPositionMs;
      if (delta > 0 && delta <= MAX_LISTEN_DELTA_MS) {
        this.listenedMs += delta;
      }
    }

    this.lastTrackedPositionMs = positionMs;

    if (status.didJustFinish) {
      await this.handleTrackEnded();
      return;
    }

    // Sync to Audiobookshelf/local storage on interval and pauses.
    if (status.isPlaying && Date.now() - this.lastSyncAt >= SYNC_INTERVAL_MS) {
      await this.syncProgress("interval");
    }

    if (this.lastIsPlaying && !status.isPlaying) {
      await this.syncProgress("pause");
    }

    this.lastIsPlaying = status.isPlaying;
  }

  private async handleTrackEnded() {
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    const nextIndex = state.currentTrackIndex + 1;
    if (nextIndex >= state.queue.length) {
      playbackStore.getState().actions.setPlaybackState("ended");
      await this.syncProgress("end");
      return;
    }

    await this.loadTrack(nextIndex, { initialPositionMs: 0, autoPlay: true });
  }

  private async syncProgress(reason: "interval" | "pause" | "background" | "end") {
    const state = playbackStore.getState();
    if (!state.bookId || !state.sessionId) return;
    this.logDebug(`syncProgress: ${reason}`);

    // Convert values to seconds to match Audiobookshelf API expectations.
    const currentTimeSeconds = msToSeconds(state.positionMs);
    const durationSeconds = msToSeconds(state.durationMs);
    const timeListenedSeconds = msToSeconds(this.listenedMs);
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);

    try {
      if (state.sessionId !== "local") {
        await sessionsApi.syncSession(state.sessionId, {
          timeListened: timeListenedSeconds,
          currentTime: currentTimeSeconds,
          duration: durationSeconds || undefined,
        });
        // If playback is from a downloaded item, use updateProgress instead of syncSession.
      }

      const currentChapterIndex = state.currentChapterId
        ? state.chapterIndex.findIndex((chapter) => chapter.id === state.currentChapterId)
        : 0;

      booksStore.getState().actions.setProgress(state.bookId, {
        currentPosition: state.positionMs,
        currentChapterIndex: Math.max(0, currentChapterIndex),
      });

      this.lastSyncAt = Date.now();
      playbackStore.getState().actions.setLastSyncAt(this.lastSyncAt);
    } catch (error) {
      playbackStore.getState().actions.setError(`Sync failed (${reason})`);
    }
  }

  private logDebug(message: string) {
    if (!DEBUG_PLAYBACK_EVENTS) return;
    playbackStore.getState().actions.setDebugMessage(message);
    if (__DEV__) {
    }
  }

  private logSnapshot(context: string) {
    if (!DEBUG_PLAYBACK_EVENTS) return;
    const snapshot = this.engine.getDebugSnapshot();
    playbackStore.getState().actions.setDebugSnapshot(snapshot);
    if (__DEV__) {
    }
  }
}

export const playerService = new PlayerService();
