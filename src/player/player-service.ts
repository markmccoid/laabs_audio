import { meApi, type UserServerState } from "../api/me-api";
import { playbackApi } from "../api/playback-api";
import { sessionsApi } from "../api/sessions-api";
import { authStore } from "../auth/auth-store";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import {
  DEFAULT_BOOK_PLAYBACK_RATE,
  deviceBooksStore,
  selectBookPlaybackRate,
  selectBookPlaybackRateIfStored,
  selectIsBookDownloaded,
  type DownloadTrack,
} from "../store/device-books-store";
import { settingsStore } from "../store/settings-store";
import type { AudioTrack } from "../types/absTypes";
import { createAudioEngine } from "./audio-engine";
import { buildChapterIndex, findChapterForPosition, findTrackForPosition } from "./chapters";
import type { PlaybackStoreState } from "./playback-store";
import { playbackStore } from "./playback-store";
import { buildPlaybackQueue } from "./queue";
import type { PitchCorrectionQuality, PlaybackQueueItem } from "./types";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_LISTEN_DELTA_MS = 5000;
const DEBUG_PLAYBACK_EVENTS = false;
const CHAPTER_RESTART_THRESHOLD_MS = 3000;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2.0;
const LOCAL_SESSION_ID = "local";

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const msToSeconds = (value: number) => Math.max(0, Math.floor(value / 1000));
const clampPlaybackRate = (rate: number) =>
  Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate));
const truncateForLog = (value: string, max = 140) =>
  value.length > max ? `${value.slice(0, max)}...` : value;
const toQueueLogEntry = (track: PlaybackQueueItem, index: number) => ({
  index,
  id: track.id,
  sessionId: track.sessionId,
  trackIndex: track.trackIndex,
  title: track.title,
  isLocal: Boolean(track.source.isLocal),
  uri: track.source.uri ? truncateForLog(track.source.uri) : null,
  sourceModule:
    typeof track.source.sourceModule === "number" ? track.source.sourceModule : undefined,
  startOffsetMs: track.startOffsetMs,
  durationMs: track.durationMs,
});

// Orchestrates playback between the UI, store, and audio engine.
class PlayerService {
  private engine = createAudioEngine();
  private lastTrackedPositionMs = 0;
  private listenedMs = 0;
  private lastSyncAttemptAt = 0;
  private lastSyncAt = 0;
  private initialized = false;
  private localStreamFallbackInFlight = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
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
    this.initialized = false;
  }

  private logQueue(context: string, queue: PlaybackQueueItem[]) {
    if (!__DEV__) return;
    console.log(`[player-service] queue:${context}`, {
      trackCount: queue.length,
      tracks: queue.map((track, index) => toQueueLogEntry(track, index)),
    });
  }

  private logPlaybackResult(event: "started" | "failed", details?: Record<string, unknown>) {
    if (!__DEV__) return;
    const state = playbackStore.getState();
    const activeTrack = state.queue[state.currentTrackIndex];
    const mode = activeTrack?.source.isLocal ? "downloaded" : "streaming";
    console.log("[player-service] playback:result", {
      event,
      mode,
      libraryItemId: state.libraryItemId,
      sessionId: state.sessionId,
      currentTrackIndex: state.currentTrackIndex,
      track: activeTrack ? toQueueLogEntry(activeTrack, state.currentTrackIndex) : null,
      ...details,
    });
  }

  async loadBook(
    libraryItemId: string,
    options?: { autoPlay?: boolean },
    internalOptions?: { preferDownloaded?: boolean },
  ) {
    playbackStore.getState().actions.setPlaybackState("loading");
    playbackStore.getState().actions.setError(null);
    const preferDownloaded = internalOptions?.preferDownloaded ?? true;
    let attemptedDownloadedAudio = false;

    if (__DEV__) {
      console.log("[player-service] loadBook:start", { libraryItemId });
    }

    try {
      const downloadedSession = preferDownloaded ? this.resolveDownloadedSession(libraryItemId) : null;
      const shouldUseDownloadedAudio = Boolean(downloadedSession);
      attemptedDownloadedAudio = shouldUseDownloadedAudio;
      let resolvedLibraryItemId = libraryItemId;
      let resolvedSessionId = LOCAL_SESSION_ID;
      let queue: PlaybackQueueItem[] = [];
      let durationMs = 0;
      let chapterIndex: ReturnType<typeof buildChapterIndex> = [];

      if (downloadedSession) {
        resolvedLibraryItemId = downloadedSession.libraryItemId;
        resolvedSessionId = downloadedSession.sessionId;
        queue = downloadedSession.queue;
        durationMs = downloadedSession.durationMs;
        chapterIndex = downloadedSession.chapterIndex;
        this.logQueue("downloaded", queue);
      } else {
        // Fallback to streamed playback when no valid local download metadata is available.
        const session = await playbackApi.getPlayInfo(libraryItemId);
        console.log("SessionInfo for", session.libraryItemId, session.displayTitle);
        resolvedLibraryItemId = session.libraryItem.id;
        resolvedSessionId = session.id;
        const builtQueue = buildPlaybackQueue(session);
        queue = builtQueue.queue;
        durationMs = builtQueue.durationMs;
        chapterIndex = buildChapterIndex(session.chapters, session.audioTracks);
        this.logQueue("streaming", queue);
      }

      const rateCandidateIds = this.buildCandidateIds(resolvedLibraryItemId, libraryItemId);
      const storedBookRate = this.resolveStoredBookRate(rateCandidateIds);
      const cachedUserServerState = await this.getCachedUserServerState({
        fetchIfMissing: !shouldUseDownloadedAudio,
      });
      const resumePositionMs = this.resolveResumePositionMs(rateCandidateIds, cachedUserServerState);
      if (!shouldUseDownloadedAudio) {
        // Keep remote progress cache fresh for streamed sessions.
        this.reconcileBookProgressFromServer(resolvedLibraryItemId);
      }

      this.listenedMs = 0;
      this.lastSyncAttemptAt = 0;
      this.lastSyncAt = 0;
      this.lastTrackedPositionMs = 0;

      playbackStore.getState().actions.setSession({
        libraryItemId: resolvedLibraryItemId,
        sessionId: resolvedSessionId,
        queue,
        durationMs,
        chapterIndex,
      });
      if (__DEV__) {
        console.log("[player-service] session:set", {
          libraryItemId: resolvedLibraryItemId,
          sessionId: resolvedSessionId,
          durationMs,
          chapterCount: chapterIndex.length,
          trackCount: queue.length,
        });
      }
      playbackStore.getState().actions.setRate(storedBookRate);

      const targetTrack = findTrackForPosition(queue, resumePositionMs) ?? queue[0];
      const targetIndex = queue.indexOf(targetTrack);
      const trackPositionMs = Math.max(0, resumePositionMs - targetTrack.startOffsetMs);

      await this.loadTrack(targetIndex, { initialPositionMs: trackPositionMs });
      this.logSnapshot("after loadBook");

      if (options?.autoPlay) {
        await this.play();
        if (shouldUseDownloadedAudio) {
          const postPlayState = playbackStore.getState();
          if (postPlayState.playbackState !== "playing") {
            await this.loadBook(libraryItemId, options, { preferDownloaded: false });
            return;
          }
        }
      } else {
        playbackStore.getState().actions.setPlaybackState("ready");
      }
    } catch (error) {
      if (preferDownloaded && attemptedDownloadedAudio) {
        try {
          await this.loadBook(libraryItemId, options, { preferDownloaded: false });
          return;
        } catch {
          // Fall through to existing error handling.
        }
      }
      if (__DEV__) {
        console.log("[player-service] loadBook:error", { libraryItemId, error });
      }
      const message = error instanceof Error ? error.message : "Unable to load book";
      const hasQueue = playbackStore.getState().queue.length > 0;
      playbackStore.getState().actions.setPlaybackState(hasQueue ? "ready" : "error");
      playbackStore.getState().actions.setError(message);
      throw error;
    }
  }

  async loadLocalFile(payload: {
    libraryItemId: string;
    title: string;
    author: string;
    uri?: string;
    sourceModule?: number;
    durationMs?: number;
    autoPlay?: boolean;
  }) {
    this.logDebug(
      `loadLocalFile: ${payload.libraryItemId} sourceModule=${typeof payload.sourceModule} uri=${payload.uri ?? "none"}`,
    );
    if (!payload.uri && typeof payload.sourceModule !== "number") {
      throw new Error("loadLocalFile requires a uri or sourceModule");
    }
    const durationMs = payload.durationMs ?? 0;
    // Local-only queue with a single track (used for development/testing).
    const queue: PlaybackQueueItem[] = [
      {
        id: `${payload.libraryItemId}-local`,
        libraryItemId: payload.libraryItemId,
        sessionId: LOCAL_SESSION_ID,
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
      libraryItemId: payload.libraryItemId,
      sessionId: LOCAL_SESSION_ID,
      queue,
      durationMs,
      chapterIndex: [],
    });
    const storedBookRate =
      selectBookPlaybackRate(deviceBooksStore.getState(), payload.libraryItemId) ??
      DEFAULT_BOOK_PLAYBACK_RATE;
    playbackStore.getState().actions.setRate(storedBookRate);

    this.listenedMs = 0;
    this.lastSyncAttemptAt = 0;
    this.lastSyncAt = 0;
    this.lastTrackedPositionMs = 0;

    await this.loadTrack(0, { initialPositionMs: 0 });
    this.logSnapshot("after loadLocalFile");

    if (payload.autoPlay) {
      await this.play();
    } else {
      playbackStore.getState().actions.setPlaybackState("ready");
    }
  }

  private buildCandidateIds(...ids: (string | null | undefined)[]) {
    return ids
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .filter((value, index, source) => source.indexOf(value) === index);
  }

  private resolveStoredBookRate(rateCandidateIds: string[]) {
    if (!rateCandidateIds.length) {
      return DEFAULT_BOOK_PLAYBACK_RATE;
    }
    const deviceBooksState = deviceBooksStore.getState();
    return (
      rateCandidateIds
        .map((candidateId) => selectBookPlaybackRateIfStored(deviceBooksState, candidateId))
        .find((rate) => rate !== null) ??
      selectBookPlaybackRate(deviceBooksState, rateCandidateIds[0]) ??
      DEFAULT_BOOK_PLAYBACK_RATE
    );
  }

  private async getCachedUserServerState(options?: { fetchIfMissing?: boolean }) {
    const { fetchIfMissing = false } = options ?? {};
    const activeLibraryUserKey = authStore.getState().activeLibraryUserKey;
    if (!activeLibraryUserKey) {
      return undefined;
    }

    const userServerStateQueryKey = queryKeys.userServerState(activeLibraryUserKey);
    let cachedUserServerState = queryClient.getQueryData<UserServerState>(userServerStateQueryKey);
    if (cachedUserServerState || !fetchIfMissing) {
      return cachedUserServerState;
    }

    try {
      cachedUserServerState = await queryClient.fetchQuery({
        queryKey: userServerStateQueryKey,
        queryFn: () => meApi.getUserServerState(),
        meta: { persist: true },
      });
    } catch {
      cachedUserServerState = undefined;
    }

    return cachedUserServerState;
  }

  private resolveResumePositionMs(candidateIds: string[], cachedUserServerState?: UserServerState) {
    const progressByLibraryItemId =
      cachedUserServerState?.progressByLibraryItemId ??
      // Compatibility for older persisted query shape.
      (
        cachedUserServerState as UserServerState & {
          progressByBookId?: UserServerState["progressByLibraryItemId"];
        }
      )?.progressByBookId ??
      {};

    const cachedUserProgress = candidateIds
      .map((candidateId) => progressByLibraryItemId[candidateId])
      .find((progress) => typeof progress?.currentTime === "number");
    const localBookProgressMs =
      typeof cachedUserProgress?.currentTime === "number"
        ? secondsToMs(cachedUserProgress.currentTime)
        : null;

    // Fallback to persisted playback position for safety when no local progress exists.
    const persisted = playbackStore.getState();
    const persistedPositionMs =
      candidateIds.some((candidateId) => persisted.libraryItemId === candidateId)
        ? persisted.positionMs
        : 0;

    return localBookProgressMs ?? persistedPositionMs;
  }

  private resolveDownloadedSession(libraryItemId: string): {
    libraryItemId: string;
    sessionId: string;
    queue: PlaybackQueueItem[];
    durationMs: number;
    chapterIndex: ReturnType<typeof buildChapterIndex>;
  } | null {
    const state = deviceBooksStore.getState();
    const details = state.downloadedDetailsById[libraryItemId];
    const downloadInfo = state.downloadedBookData[libraryItemId];
    if (!details || !downloadInfo?.audioTracks?.length) {
      if (__DEV__) {
        console.log("[player-service] downloaded:missing-or-empty", {
          libraryItemId,
          hasDetails: Boolean(details),
          downloadedTrackCount: downloadInfo?.audioTracks?.length ?? 0,
        });
      }
      return null;
    }

    const downloadTrackByIno = new Map(
      downloadInfo.audioTracks.map((downloadTrack) => [downloadTrack.ino, downloadTrack] as const),
    );
    const orderedTracksFromDetails = details.media.audioFiles
      .map((audioFile) => downloadTrackByIno.get(audioFile.ino))
      .filter((track): track is DownloadTrack => Boolean(track));
    const remainingTracks = downloadInfo.audioTracks.filter(
      (track) => !details.media.audioFiles.some((audioFile) => audioFile.ino === track.ino),
    );
    const orderedTracks = [...orderedTracksFromDetails, ...remainingTracks];
    const detailsTrackByIno = new Map(
      details.media.audioFiles.map((audioFile) => [audioFile.ino, audioFile] as const),
    );
    const normalizedTracks: (DownloadTrack & {
      normalizedStartOffset: number;
      normalizedDuration: number;
    })[] = [];
    let rollingStartOffset = 0;
    orderedTracks.forEach((track) => {
      const detailsTrack = detailsTrackByIno.get(track.ino);
      const normalizedDuration =
        Number.isFinite(track.duration) && track.duration > 0
          ? track.duration
          : Number.isFinite(detailsTrack?.duration) && (detailsTrack?.duration ?? 0) > 0
            ? (detailsTrack?.duration ?? 0)
            : 0;
      const preferredStartOffset =
        Number.isFinite(track.startOffset) && track.startOffset >= 0
          ? track.startOffset
          : rollingStartOffset;
      const normalizedStartOffset = Math.max(rollingStartOffset, preferredStartOffset);
      normalizedTracks.push({
        ...track,
        normalizedStartOffset,
        normalizedDuration,
      });
      rollingStartOffset = normalizedStartOffset + normalizedDuration;
    });

    const author =
      details.media.metadata.authors?.map((value) => value.name).join(", ") ||
      details.media.metadata.authorName ||
      "Unknown";
    const fallbackTitle = details.media.metadata.title || "Unknown";
    const queue: PlaybackQueueItem[] = normalizedTracks
      .filter((track) => typeof track.fileUri === "string" && track.fileUri.length > 0)
      .map((track, trackIndex) =>
        this.toDownloadedQueueItem({
          libraryItemId,
          author,
          fallbackTitle,
          track,
          trackIndex,
          detailsTrack: detailsTrackByIno.get(track.ino),
        }),
      );
    if (!queue.length) {
      if (__DEV__) {
        console.log("[player-service] downloaded:no-playable-tracks", {
          libraryItemId,
          downloadedTrackCount: downloadInfo.audioTracks.length,
          normalizedTrackCount: normalizedTracks.length,
        });
      }
      return null;
    }

    const audioTracks: AudioTrack[] = normalizedTracks.map((track, trackIndex) => {
      const detailsTrack = detailsTrackByIno.get(track.ino);
      return {
        index: trackIndex,
        startOffset: track.normalizedStartOffset,
        duration: track.normalizedDuration,
        title: detailsTrack?.title || track.filename || fallbackTitle,
        contentUrl: "",
        mimeType: detailsTrack?.mimeType || "audio/mpeg",
        codec: detailsTrack?.codec ?? null,
        metadata: null,
      };
    });

    const chapterIndex = buildChapterIndex(details.media.chapters, audioTracks);
    const fallbackDurationMs = queue.reduce((total, track) => total + track.durationMs, 0);
    const durationMs = secondsToMs(details.media.duration) || fallbackDurationMs;
    if (__DEV__) {
      console.log("[player-service] downloaded:resolved", {
        libraryItemId,
        detailsAudioFileCount: details.media.audioFiles.length,
        downloadedTrackCount: downloadInfo.audioTracks.length,
        normalizedTrackCount: normalizedTracks.length,
        queueTrackCount: queue.length,
        durationMs,
      });
    }

    return {
      libraryItemId,
      sessionId: LOCAL_SESSION_ID,
      queue,
      durationMs,
      chapterIndex,
    };
  }

  private toDownloadedQueueItem(payload: {
    libraryItemId: string;
    author: string;
    fallbackTitle: string;
    track: DownloadTrack & { normalizedStartOffset?: number; normalizedDuration?: number };
    trackIndex: number;
    detailsTrack?: {
      title?: string;
      mimeType?: string;
    };
  }): PlaybackQueueItem {
    return {
      id: `${payload.libraryItemId}-download-${payload.trackIndex}`,
      libraryItemId: payload.libraryItemId,
      sessionId: LOCAL_SESSION_ID,
      trackIndex: payload.trackIndex,
      title: payload.detailsTrack?.title || payload.track.filename || payload.fallbackTitle,
      author: payload.author,
      durationMs: secondsToMs(payload.track.normalizedDuration ?? payload.track.duration),
      startOffsetMs: secondsToMs(payload.track.normalizedStartOffset ?? payload.track.startOffset),
      source: {
        uri: payload.track.fileUri,
        mimeType: payload.detailsTrack?.mimeType,
        isLocal: true,
      },
    };
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

      // Ensure speed is reapplied after native playback starts.
      await this.engine.setRate(
        playbackStore.getState().rate,
        settingsStore.getState().pitchCorrectionQuality,
      );

      this.logSnapshot("after play");
      playbackStore.getState().actions.setPlaybackState("playing");
      playbackStore.getState().actions.setError(null);
      this.touchUserServerStateCacheForPlayStart();
      this.logPlaybackResult("started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start playback";
      const currentState = playbackStore.getState();
      const shouldFallbackToStreaming =
        currentState.sessionId === LOCAL_SESSION_ID &&
        Boolean(currentState.libraryItemId) &&
        !this.localStreamFallbackInFlight &&
        authStore.getState().status === "authenticated" &&
        authStore.getState().isOnline !== false;

      if (shouldFallbackToStreaming) {
        this.localStreamFallbackInFlight = true;
        try {
          if (__DEV__) {
            console.log("[player-service] play:fallback-to-streaming", {
              libraryItemId: currentState.libraryItemId,
              reason: message,
            });
          }
          await this.loadBook(currentState.libraryItemId as string, { autoPlay: true }, {
            preferDownloaded: false,
          });
          return;
        } catch (fallbackError) {
          if (__DEV__) {
            console.log("[player-service] play:fallback-failed", {
              libraryItemId: currentState.libraryItemId,
              error: fallbackError,
            });
          }
        } finally {
          this.localStreamFallbackInFlight = false;
        }
      }

      const finalState = playbackStore.getState();
      if (finalState.queue.length > 0) {
        playbackStore.getState().actions.setPlaybackState("ready");
      } else {
        playbackStore.getState().actions.setPlaybackState("error");
      }
      playbackStore.getState().actions.setError(message);
      this.logPlaybackResult("failed", { reason: message });
    }
  }

  async pause() {
    this.logDebug("pause");
    await this.engine.pause();
    this.logSnapshot("after pause");
    playbackStore.getState().actions.setPlaybackState("paused");
    await this.syncProgress("pause");
  }

  async stop() {
    await this.engine.pause();
    await this.engine.unload();
    playbackStore.getState().actions.reset();
    this.listenedMs = 0;
    this.lastSyncAttemptAt = 0;
    this.lastSyncAt = 0;
    this.lastTrackedPositionMs = 0;
  }

  async togglePlayPause() {
    const state = playbackStore.getState();
    if (state.playbackState === "playing") {
      await this.pause();
      return;
    }
    if (state.playbackState === "loading") return;
    if (!state.queue.length) {
      if (state.libraryItemId) {
        await this.loadBook(state.libraryItemId, { autoPlay: true });
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
    await this.syncProgress("seek");
  }

  async skipBy(seconds: number, goBackwards: boolean = false) {
    const state = playbackStore.getState();
    if (!state.queue.length) return;
    let skipMs = secondsToMs(seconds);
    if (goBackwards) {
      skipMs = -skipMs;
    }
    await this.seekTo(state.positionMs + skipMs);
  }

  async setRate(rate: number) {
    const normalizedRate = clampPlaybackRate(rate);
    this.logDebug(`setRate: ${normalizedRate}`);
    const state = playbackStore.getState();
    const previousPlaybackState = state.playbackState;
    playbackStore.getState().actions.setRate(normalizedRate);
    if (state.libraryItemId) {
      deviceBooksStore.getState().actions.setBookPlaybackRate(state.libraryItemId, normalizedRate);
    }
    await this.engine.setRate(normalizedRate, settingsStore.getState().pitchCorrectionQuality);

    // Some native engines may resume when changing playback speed.
    // Preserve the pre-change playback state explicitly.
    if (previousPlaybackState !== "playing") {
      try {
        await this.engine.pause();
      } catch {
        // Ignore pause failures here; state is still preserved in store.
      }
      playbackStore.getState().actions.setPlaybackState(previousPlaybackState);
    }
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
    if (__DEV__) {
      console.log("[player-service] loadTrack", {
        index,
        initialPositionMs: options?.initialPositionMs ?? 0,
        autoPlay: Boolean(options?.autoPlay),
        sessionId: state.sessionId,
        track: toQueueLogEntry(track, index),
      });
    }

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

    // Sync to Audiobookshelf/local storage on interval.
    if (status.isPlaying && Date.now() - this.lastSyncAttemptAt >= SYNC_INTERVAL_MS) {
      await this.syncProgress("interval");
    }
  }

  private async handleTrackEnded() {
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    const nextIndex = state.currentTrackIndex + 1;
    if (nextIndex >= state.queue.length) {
      playbackStore.getState().actions.setPlaybackState("ended");
      return;
    }

    await this.loadTrack(nextIndex, { initialPositionMs: 0, autoPlay: true });
  }

  private async syncProgress(reason: "interval" | "pause" | "seek") {
    const state = playbackStore.getState();
    if (!state.libraryItemId || !state.sessionId) return;
    this.logDebug(`syncProgress: ${reason}`);
    this.lastSyncAttemptAt = Date.now();

    // Convert values to seconds to match Audiobookshelf API expectations.
    const currentTimeSeconds = msToSeconds(state.positionMs);
    const durationSeconds = msToSeconds(state.durationMs);
    const timeListenedSeconds = msToSeconds(this.listenedMs);
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);

    try {
      if (state.sessionId !== LOCAL_SESSION_ID) {
        await sessionsApi.syncSession(state.sessionId, {
          timeListened: timeListenedSeconds,
          currentTime: currentTimeSeconds,
          duration: durationSeconds || undefined,
        });
      } else if (
        this.isDownloadedBook(state.libraryItemId) &&
        authStore.getState().status === "authenticated" &&
        authStore.getState().isOnline !== false
      ) {
        await meApi.updateProgress(state.libraryItemId, {
          currentTime: currentTimeSeconds,
          isFinished,
        });
      }

      this.updateUserServerStateCache({
        libraryItemId: state.libraryItemId,
        currentTimeSeconds,
        durationSeconds,
        isFinished,
      });

      this.lastSyncAt = Date.now();
      playbackStore.getState().actions.setLastSyncAt(this.lastSyncAt);
    } catch {
      playbackStore.getState().actions.setError(`Sync failed (${reason})`);
    }
  }

  private isDownloadedBook(libraryItemId: string) {
    return selectIsBookDownloaded(deviceBooksStore.getState(), libraryItemId);
  }

  private touchUserServerStateCacheForPlayStart() {
    const state = playbackStore.getState();
    if (!state.libraryItemId) return;

    const currentTimeSeconds = msToSeconds(state.positionMs);
    const durationSeconds = msToSeconds(state.durationMs);
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);

    // Promote the currently playing title in local cache immediately; server sync still
    // happens on interval/pause/seek.
    this.updateUserServerStateCache({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds,
      durationSeconds,
      isFinished,
    });
  }

  private reconcileBookProgressFromServer(libraryItemId: string) {
    meApi
      .getProgress(libraryItemId)
      .then((serverProgress) => {
        if (typeof serverProgress.currentTime !== "number") return;
        this.updateUserServerStateCache({
          libraryItemId: serverProgress.libraryItemId || libraryItemId,
          currentTimeSeconds: serverProgress.currentTime,
          durationSeconds: serverProgress.duration ?? 0,
          isFinished: Boolean(serverProgress.isFinished),
        });
      })
      .catch(() => undefined);
  }

  private updateUserServerStateCache(payload: {
    libraryItemId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    isFinished: boolean;
  }) {
    const activeLibraryUserKey = authStore.getState().activeLibraryUserKey;
    if (!activeLibraryUserKey) {
      return;
    }

    queryClient.setQueryData<UserServerState>(
      queryKeys.userServerState(activeLibraryUserKey),
      (previousState) => {
        const nextState: UserServerState = previousState ?? {
          userId: activeLibraryUserKey,
          progressByLibraryItemId: {},
          bookmarksByLibraryItemId: {},
        };
        const previousProgress = nextState.progressByLibraryItemId[payload.libraryItemId];
        const now = Date.now();
        const resolvedDuration =
          payload.durationSeconds > 0 ? payload.durationSeconds : (previousProgress?.duration ?? 0);
        const progressPercent =
          resolvedDuration > 0
            ? Math.max(0, Math.min(1, payload.currentTimeSeconds / resolvedDuration))
            : (previousProgress?.progressPercent ?? 0);

        return {
          ...nextState,
          progressByLibraryItemId: {
            ...nextState.progressByLibraryItemId,
            [payload.libraryItemId]: {
              progressId: previousProgress?.progressId ?? `${payload.libraryItemId}:local`,
              libraryItemId: payload.libraryItemId,
              duration: resolvedDuration,
              progressPercent,
              currentTime: payload.currentTimeSeconds,
              isFinished: payload.isFinished,
              hideFromContinueListening: previousProgress?.hideFromContinueListening ?? false,
              startedAt: previousProgress?.startedAt ?? now,
              finishedAt: payload.isFinished ? (previousProgress?.finishedAt ?? now) : null,
              lastUpdate: now,
            },
          },
        };
      },
    );
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
