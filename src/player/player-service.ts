import {
  createEmptyUserServerState,
  meApi,
  type UserBookProgress,
  type UserServerState,
} from "../api/me-api";
import { upsertShadowServerProgressProjection } from "../data/sqlite/overlay-writes";
import { playbackApi } from "../api/playback-api";
import { sessionsApi } from "../api/sessions-api";
import { buildCoverUrls } from "../api/cover-urls";
import { authStore } from "../auth/auth-store";
import { canUseAudiobookshelfServer } from "../auth/server-connection";
import {
  getCarPlayResumeSnapshotForCandidateIds,
  recordCarPlayResumeSnapshot,
} from "../carplay/carplay-resume-snapshot";
import { resolveListeningOwnerKey } from "../auth/listening-owner";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import { invalidateSqliteOverlayProjections } from "../query/sqlite-invalidation";
import { fetchReconciledUserServerState } from "../query/user-server-state-reconcile";
import { displayedListeningPositionStore } from "../progress/displayed-listening-position";
import { syncListeningPosition } from "../progress/listening-position-sync";
import { chooseResumeResolutionCandidate } from "../progress/resume-resolution";
import { getEpisodeProgressSyncIntent } from "../podcast/episode-progress-intent-store";
import { resolveEpisodeResumePositionSeconds } from "../podcast/episode-progress-facade";
import {
  DEFAULT_BOOK_PLAYBACK_RATE,
  deviceBooksStore,
  resolveStoredDownloadCoverUri,
  resolveStoredDownloadTrackUri,
  selectIsBookFullyDownloaded,
  selectBookPlaybackRate,
  selectBookPlaybackRateIfStored,
  type PendingProgressSync,
  type DownloadTrack,
} from "../store/device-books-store";
import {
  deviceEpisodeDownloadsStore,
  resolveDownloadedEpisodePlayback,
  resolveStoredEpisodeDownloadTrackUri,
  selectIsEpisodePlaybackDownloadReady,
} from "../store/device-episode-downloads-store";
import { resolveEpisodePlaybackSource } from "../podcast/episode-download-facade";
import {
  progressLogStore,
  type ProgressLogSessionKind,
  type ProgressResolutionCandidate,
  type ProgressResolutionSource,
  type ServerProgressFetchResult,
} from "../store/progress-log-store";
import { clampPlaybackRateToRange, settingsStore } from "../store/settings-store";
import type { AudioTrack } from "../types/absTypes";
import {
  resolveAutoRewindDecision,
  type AutoRewindDecision,
} from "./auto-rewind";
import { createAudioEngine } from "./audio-engine";
import { buildChapterIndex, findChapterForPosition, findTrackForPosition } from "./chapters";
import { clipPreviewStore } from "./clip-preview-store";
import { resolveClipPreviewAvailability } from "./clip-preview-availability";
import { describeLocalAudioSourceUri } from "./local-audio-source-diagnostics";
import {
  isPlaybackControlIntentBlocking,
  PLAYBACK_CONTROL_SETTLE_MS,
} from "./playback-control-intent";
import {
  isStreamedPlaybackStartFailure,
  LOCAL_PLAYBACK_SESSION_ID,
  resolveLocalPlaybackFallbackTarget,
  runLocalPlaybackFallback,
  StreamedPlaybackStartFailureError,
  withPlaybackStartTimeout,
} from "./playback-start-attempt";
import {
  resolvePlaybackSourceTransition,
  type PlaybackSourceTransition,
  type PlaybackSourceTransitionTarget,
} from "./playback-source-transition";
import { NativeModules } from "react-native";
import type { PlaybackStoreState } from "./playback-store";
import { playbackStore } from "./playback-store";
import { buildPlaybackQueue } from "./queue";
import type { PitchCorrectionQuality, PlaybackQueueItem } from "./types";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_LISTEN_DELTA_MS = 5000;
const PAUSE_SYNC_DEDUPE_WINDOW_MS = 2000;
const DEBUG_PLAYBACK_EVENTS = false;
const CHAPTER_RESTART_THRESHOLD_MS = 3000;
const LOCAL_SESSION_ID = LOCAL_PLAYBACK_SESSION_ID;
const PLAY_START_PROGRESS_FLOOR_TOLERANCE_SECONDS = 5;
const LOCAL_PLAYBACK_PROGRESS_TIMEOUT_MS = 4000;
const LOCAL_PLAYBACK_PROGRESS_POLL_INTERVAL_MS = 250;
const LOCAL_PLAYBACK_PROGRESS_MIN_DELTA_MS = 250;
const STALE_ZERO_PROGRESS_GUARD_SECONDS = 5;
const LOAD_PROGRESS_FETCH_TIMEOUT_MS = 350;
const POST_PREVIEW_STATUS_GUARD_MS = 2000;
const POST_PREVIEW_RESTORED_POSITION_TOLERANCE_MS = 1500;
const SKIP_BURST_SETTLE_MS = 300;
const SKIP_BURST_MAX_MS = 2000;
const NATIVE_SEEK_PAUSE_GUARD_MS = 1500;
type ProgressSyncReason =
  | "interval"
  | "pause"
  | "external_pause"
  | "seek"
  | "auto_rewind"
  | "close"
  | "logout"
  | "finish"
  | "natural_completion"
  | "download_deleted";
type CachedUserServerStateSource =
  | "unavailable"
  | "cache_hit"
  | "fetch_success"
  | "fetch_failed"
  | "skipped_fetch";
type FreshServerProgressFetchResultPayload =
  | {
      status: "applied" | "ignored_as_stale";
      progress: Awaited<ReturnType<typeof meApi.getProgress>>;
      cachedCurrentTimeSeconds: number;
      cachedLastUpdate: number;
    }
  | {
      status: "failed";
      errorMessage: string;
    };

type ClipPreviewRestoreState = {
  libraryItemId: string | null;
  episodeId: string | null;
  positionMs: number;
  playbackState: PlaybackStoreState["playbackState"];
  queueWasLoaded: boolean;
};

type ClipPreviewSession = {
  libraryItemId: string;
  episodeId: string | null;
  bookmarkId: string | null;
  startMs: number;
  endMs: number;
  restoreState: ClipPreviewRestoreState;
  currentTrackIndex: number;
  stoppedAtEnd: boolean;
};

export type DownloadedBookDeletionPlaybackSnapshot = {
  libraryItemId: string;
  wasActiveLocalSession: boolean;
  wasPlaying: boolean;
  positionMs: number;
};

export type DownloadedEpisodeDeletionPlaybackSnapshot = {
  libraryItemId: string;
  episodeId: string;
  wasActiveLocalSession: boolean;
  wasPlaying: boolean;
  positionMs: number;
  episodeTitle: string | null;
  podcastTitle: string | null;
};

type SkipBurst = {
  libraryItemId: string;
  targetPositionMs: number;
  startedAt: number;
  lastUpdatedAt: number;
};

export type PlaybackControlResult =
  | { status: "accepted"; intentId: string }
  | {
      status: "ignored";
      reason: "intent_active";
      activeIntentKind: "start" | "play" | "pause";
    }
  | { status: "already_satisfied"; state: "playing" | "paused" };

const secondsToMs = (value: number) => Math.max(0, Math.round(value * 1000));
const msToSeconds = (value: number) => Math.max(0, Math.floor(value / 1000));
const clampPlaybackRate = (rate: number) => {
  const { playbackRateRangeMin, playbackRateRangeMax } = settingsStore.getState();
  return clampPlaybackRateToRange(rate, {
    min: playbackRateRangeMin,
    max: playbackRateRangeMax,
  });
};

const pickNewestProgress = <
  T extends { libraryItemId?: string; mediaItemId?: string; lastUpdate?: number },
>(
  entries: T[],
) =>
  entries.reduce<T | null>((latest, current) => {
    if (!latest) return current;
    const latestUpdate = Math.max(0, Math.floor(latest.lastUpdate ?? 0));
    const currentUpdate = Math.max(0, Math.floor(current.lastUpdate ?? 0));
    return currentUpdate >= latestUpdate ? current : latest;
  }, null);

const pickNewestQueuedProgress = (entries: PendingProgressSync[]) =>
  entries.reduce<PendingProgressSync | null>((latest, current) => {
    if (!latest) return current;
    const latestUpdate = Math.max(0, Math.floor(latest.updatedAt ?? 0));
    const currentUpdate = Math.max(0, Math.floor(current.updatedAt ?? 0));
    return currentUpdate >= latestUpdate ? current : latest;
  }, null);

const resolveQueueDurationMs = (queue: PlaybackQueueItem[]) => {
  const lastTrack = queue[queue.length - 1];
  if (!lastTrack) return 0;
  return Math.max(0, lastTrack.startOffsetMs + lastTrack.durationMs);
};

// Orchestrates playback between the UI, store, and audio engine.
class PlayerService {
  private engine = createAudioEngine();
  private lastTrackedPositionMs = 0;
  private listenedMs = 0;
  private lastSyncAttemptAt = 0;
  private lastSyncAt = 0;
  private lastPauseSyncSignature: string | null = null;
  private lastPauseSyncAt = 0;
  private initialized = false;
  private localStreamFallbackInFlight = false;
  private playbackStartAttemptId = 0;
  private playbackControlIntentClearTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSkipBurst: SkipBurst | null = null;
  private skipBurstSettleTimeout: ReturnType<typeof setTimeout> | null = null;
  private skipBurstMaxTimeout: ReturnType<typeof setTimeout> | null = null;
  private skipSeekInFlight: Promise<void> | null = null;
  private nativeSeekPauseGuardUntilMs = 0;
  private clipPreviewSession: ClipPreviewSession | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private unsubscribeBookDownloads: (() => void) | null = null;
  private unsubscribeEpisodeDownloads: (() => void) | null = null;
  private playbackSourceTransitionInFlight = false;
  private pendingPlaybackSourceTransition: PlaybackSourceTransition | null = null;
  private postPreviewStatusGuard:
    | {
        untilMs: number;
        restoredPositionMs: number;
      }
    | null = null;

  private createPlaybackControlIntentId(kind: "start" | "play" | "pause") {
    return `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Playback breadcrumbs. console.log is the reliable device-log channel:
  // RCTLog forwards it to os_log at Info level, which idevicesyslog relays
  // even in Release builds — verified on hardware 2026-07-03. (NSLog-based
  // mirrors do NOT relay through idevicesyslog on current iOS, so the native
  // carPlayLog mirror is only a Console.app convenience, not the main path.)
  // Fires once per load step — negligible cost.
  private playbackTrace(message: string) {
    console.log("[player-service][trace]", message);
    try {
      NativeModules.AudioPro?.carPlayLog?.(`trace ${message}`);
    } catch {
      // Tracing must never break playback.
    }
  }

  private beginPlaybackControlIntent(payload: {
    kind: "start" | "play" | "pause";
    libraryItemId: string | null;
    episodeId?: string | null;
    requestedAudibleState: "playing" | "paused";
  }): PlaybackControlResult {
    const activeIntent = playbackStore.getState().playbackControlIntent;
    if (activeIntent) {
      const now = Date.now();
      const ageMs = now - activeIntent.startedAt;
      // Time-based clearing, checked at the next control request: the settle
      // timer in finishPlaybackControlIntent never fires in a headless
      // CarPlay launch (JS timers are frozen in background), so a finished
      // intent must not depend on it to unblock the gate.
      const settleExpired =
        typeof activeIntent.finishedAt === "number" &&
        now - activeIntent.finishedAt >= PLAYBACK_CONTROL_SETTLE_MS;
      if (isPlaybackControlIntentBlocking(activeIntent, now)) {
        return {
          status: "ignored",
          reason: "intent_active",
          activeIntentKind: activeIntent.kind,
        };
      }
      this.playbackTrace(
        `intent:${settleExpired ? "settle-expired" : "stale"}-cleared kind=${activeIntent.kind} ageMs=${ageMs} item=${activeIntent.libraryItemId ?? "none"}`,
      );
      playbackStore.getState().actions.setPlaybackControlIntent(null);
    }

    if (this.playbackControlIntentClearTimeout) {
      clearTimeout(this.playbackControlIntentClearTimeout);
      this.playbackControlIntentClearTimeout = null;
    }

    const intentId = this.createPlaybackControlIntentId(payload.kind);
    playbackStore.getState().actions.setPlaybackControlIntent({
      id: intentId,
      kind: payload.kind,
      libraryItemId: payload.libraryItemId,
      episodeId: payload.episodeId ?? null,
      requestedAudibleState: payload.requestedAudibleState,
      startedAt: Date.now(),
    });
    return { status: "accepted", intentId };
  }

  private hasBlockingPlaybackControlIntent() {
    const intent = playbackStore.getState().playbackControlIntent;
    if (!intent) return false;
    if (isPlaybackControlIntentBlocking(intent, Date.now())) return true;

    playbackStore.getState().actions.setPlaybackControlIntent(null);
    return false;
  }

  private finishPlaybackControlIntent(intentId: string) {
    // Stamp finishedAt synchronously — gate checks treat an expired settle
    // window as cleared even if the timer below never fires (JS timers are
    // frozen in a headless/background CarPlay launch).
    const activeIntent = playbackStore.getState().playbackControlIntent;
    if (activeIntent?.id === intentId && typeof activeIntent.finishedAt !== "number") {
      playbackStore.getState().actions.setPlaybackControlIntent({
        ...activeIntent,
        finishedAt: Date.now(),
      });
    }

    if (this.playbackControlIntentClearTimeout) {
      clearTimeout(this.playbackControlIntentClearTimeout);
      this.playbackControlIntentClearTimeout = null;
    }

    this.playbackControlIntentClearTimeout = setTimeout(() => {
      this.playbackControlIntentClearTimeout = null;
      this.clearPlaybackControlIntent(intentId);
    }, PLAYBACK_CONTROL_SETTLE_MS);
  }

  private clearPlaybackControlIntent(intentId: string) {
    const activeIntent = playbackStore.getState().playbackControlIntent;
    if (activeIntent?.id === intentId) {
      playbackStore.getState().actions.setPlaybackControlIntent(null);
    }
  }

  private runPlaybackFollowUp(label: string, task: () => Promise<unknown> | unknown) {
    try {
      void Promise.resolve(task()).catch((error) => {
        if (__DEV__) {
          console.warn(`[player-service] follow-up failed: ${label}`, { error });
        }
      });
    } catch (error) {
      if (__DEV__) {
        console.warn(`[player-service] follow-up failed: ${label}`, { error });
      }
    }
  }

  private clearSkipBurstTimers() {
    if (this.skipBurstSettleTimeout) {
      clearTimeout(this.skipBurstSettleTimeout);
      this.skipBurstSettleTimeout = null;
    }
    if (this.skipBurstMaxTimeout) {
      clearTimeout(this.skipBurstMaxTimeout);
      this.skipBurstMaxTimeout = null;
    }
  }

  private cancelPendingSkipBurst() {
    this.clearSkipBurstTimers();
    this.pendingSkipBurst = null;
  }

  private getSkipBasePositionMs(state: PlaybackStoreState) {
    if (this.pendingSkipBurst?.libraryItemId === state.libraryItemId) {
      return this.pendingSkipBurst.targetPositionMs;
    }

    const displayedPosition = state.libraryItemId
      ? displayedListeningPositionStore.getState().byLibraryItemId[state.libraryItemId]
      : null;
    return displayedPosition?.positionMs ?? state.positionMs;
  }

  private scheduleSkipBurstFlush() {
    const burst = this.pendingSkipBurst;
    if (!burst) return;

    if (this.skipBurstSettleTimeout) {
      clearTimeout(this.skipBurstSettleTimeout);
    }
    this.skipBurstSettleTimeout = setTimeout(() => {
      this.skipBurstSettleTimeout = null;
      void this.flushPendingSkipBurst();
    }, SKIP_BURST_SETTLE_MS);

    if (!this.skipBurstMaxTimeout) {
      const remainingMaxMs = Math.max(0, SKIP_BURST_MAX_MS - (Date.now() - burst.startedAt));
      this.skipBurstMaxTimeout = setTimeout(() => {
        this.skipBurstMaxTimeout = null;
        void this.flushPendingSkipBurst();
      }, remainingMaxMs);
    }
  }

  private async flushPendingSkipBurst() {
    const burst = this.pendingSkipBurst;
    if (!burst || this.skipSeekInFlight) return;

    this.pendingSkipBurst = null;
    this.clearSkipBurstTimers();

    const seekPromise = this.seekToImmediate(burst.targetPositionMs, {
      confirmDisplayedPosition: playbackStore.getState().playbackState !== "playing",
      rollbackOptimisticPositionMs: burst.targetPositionMs,
      syncProgress: true,
      allowDuringPlaybackControlIntent: true,
    }).catch((error) => {
      if (__DEV__) {
        console.warn("[player-service] skip-burst:seek-failed", {
          libraryItemId: burst.libraryItemId,
          targetPositionMs: burst.targetPositionMs,
          error,
        });
      }
    });

    this.skipSeekInFlight = seekPromise;
    try {
      await seekPromise;
    } finally {
      if (this.skipSeekInFlight === seekPromise) {
        this.skipSeekInFlight = null;
      }
    }

    const nextBurst = this.pendingSkipBurst as SkipBurst | null;
    if (!nextBurst) return;

    const quietWindowElapsed = Date.now() - nextBurst.lastUpdatedAt >= SKIP_BURST_SETTLE_MS;
    const maxWindowElapsed = Date.now() - nextBurst.startedAt >= SKIP_BURST_MAX_MS;
    if (quietWindowElapsed || maxWindowElapsed) {
      await this.flushPendingSkipBurst();
    } else {
      this.scheduleSkipBurstFlush();
    }
  }

  private async flushPendingSkipBurstBeforeExit() {
    await this.flushPendingSkipBurst();
    if (this.skipSeekInFlight) {
      await this.skipSeekInFlight.catch(() => undefined);
    }
  }

  private async waitForDownloadedPlaybackProgress() {
    const startedAt = Date.now();
    const initialTrackPositionMs = await this.engine.getPositionMs();
    let lastPositionMs = initialTrackPositionMs;

    while (Date.now() - startedAt < LOCAL_PLAYBACK_PROGRESS_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, LOCAL_PLAYBACK_PROGRESS_POLL_INTERVAL_MS));
      const positionMs = await this.engine.getPositionMs();
      lastPositionMs = positionMs;
      if (positionMs >= initialTrackPositionMs + LOCAL_PLAYBACK_PROGRESS_MIN_DELTA_MS) {
        return;
      }
    }

    const snapshot = this.engine.getDebugSnapshot();
    void snapshot;
    void lastPositionMs;
    throw new Error("Downloaded playback did not advance after play");
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    if (this.playbackControlIntentClearTimeout) {
      clearTimeout(this.playbackControlIntentClearTimeout);
      this.playbackControlIntentClearTimeout = null;
    }
    playbackStore.getState().actions.setPlaybackControlIntent(null);
    this.engine.setEvents({
      onEnded: () => {
        void this.handleTrackEnded();
      },
      onError: (error) => {
        if (this.clipPreviewSession) {
          clipPreviewStore.getState().actions.setError(error.message);
        } else {
          playbackStore.getState().actions.setError(error.message);
        }
        this.logDebug(`engine error: ${error.message}`);
      },
      onStatus: (status) => {
        void this.handleStatus(status);
      },
      onRemoteNext: () => {
        if (settingsStore.getState().remoteCommandMode !== "next-prev") return;
        void this.nextChapter();
      },
      onRemotePrevious: () => {
        if (settingsStore.getState().remoteCommandMode !== "next-prev") return;
        void this.previousChapter();
      },
    });
    this.unsubscribeSettings = settingsStore.subscribe((state, previousState) => {
      if (
        state.playbackRateRangeMin !== previousState.playbackRateRangeMin ||
        state.playbackRateRangeMax !== previousState.playbackRateRangeMax
      ) {
        void this.reconcilePlaybackRateRange();
      }
    });
    this.unsubscribeBookDownloads = deviceBooksStore.subscribe((state, previousState) => {
      const playback = playbackStore.getState();
      const libraryItemId = playback.episodeId ? null : playback.libraryItemId;
      if (!libraryItemId) return;
      this.handlePlaybackDownloadAvailabilityChange({
        target: { kind: "book", libraryItemId },
        wasDownloadReady: selectIsBookFullyDownloaded(previousState, libraryItemId),
        isDownloadReady: selectIsBookFullyDownloaded(state, libraryItemId),
      });
    });
    this.unsubscribeEpisodeDownloads = deviceEpisodeDownloadsStore.subscribe(
      (state, previousState) => {
        const playback = playbackStore.getState();
        if (!playback.libraryItemId || !playback.episodeId) return;
        const target = {
          kind: "episode" as const,
          libraryItemId: playback.libraryItemId,
          episodeId: playback.episodeId,
        };
        this.handlePlaybackDownloadAvailabilityChange({
          target,
          wasDownloadReady: selectIsEpisodePlaybackDownloadReady(previousState, target),
          isDownloadReady: selectIsEpisodePlaybackDownloadReady(state, target),
        });
      },
    );
  }

  destroy() {
    this.initialized = false;
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.unsubscribeBookDownloads?.();
    this.unsubscribeBookDownloads = null;
    this.unsubscribeEpisodeDownloads?.();
    this.unsubscribeEpisodeDownloads = null;
    this.pendingPlaybackSourceTransition = null;
    this.cancelPendingSkipBurst();
  }

  private handlePlaybackDownloadAvailabilityChange(payload: {
    target: PlaybackSourceTransitionTarget;
    wasDownloadReady: boolean;
    isDownloadReady: boolean;
  }) {
    const state = playbackStore.getState();
    const transition = resolvePlaybackSourceTransition({
      playback: {
        libraryItemId: state.libraryItemId,
        episodeId: state.episodeId,
        sessionId: state.sessionId,
        hasLoadedQueue: state.queue.length > 0,
        playbackState: state.playbackState,
      },
      ...payload,
    });
    if (!transition) return;

    this.pendingPlaybackSourceTransition = transition;
    if (this.playbackSourceTransitionInFlight) return;
    this.playbackSourceTransitionInFlight = true;
    void this.drainPlaybackSourceTransitions();
  }

  private async drainPlaybackSourceTransitions() {
    try {
      while (this.pendingPlaybackSourceTransition) {
        const transition = this.pendingPlaybackSourceTransition;
        this.pendingPlaybackSourceTransition = null;
        await this.applyPlaybackSourceTransition(transition);
      }
    } finally {
      this.playbackSourceTransitionInFlight = false;
      if (this.pendingPlaybackSourceTransition) {
        this.playbackSourceTransitionInFlight = true;
        void this.drainPlaybackSourceTransitions();
      }
    }
  }

  private async applyPlaybackSourceTransition(transition: PlaybackSourceTransition) {
    const state = playbackStore.getState();
    const targetMatches =
      state.libraryItemId === transition.target.libraryItemId &&
      (transition.target.kind === "episode"
        ? state.episodeId === transition.target.episodeId
        : state.episodeId === null);
    if (!targetMatches || !state.queue.length) return;

    const isDownloadReady =
      transition.target.kind === "episode"
        ? selectIsEpisodePlaybackDownloadReady(
            deviceEpisodeDownloadsStore.getState(),
            transition.target,
          )
        : selectIsBookFullyDownloaded(
            deviceBooksStore.getState(),
            transition.target.libraryItemId,
          );
    const currentIsLocal = state.sessionId === LOCAL_SESSION_ID;
    if (currentIsLocal === isDownloadReady) return;

    const positionMs = state.positionMs;
    const shouldResumePlaying = state.playbackState === "playing";
    const episodeTitle = state.bookTitle;
    const podcastTitle = state.secondaryTitle;

    try {
      await this.closeActiveBookForTransition();
      if (transition.target.kind === "episode") {
        await this.loadEpisode(
          transition.target.libraryItemId,
          transition.target.episodeId,
          {
            autoPlay: false,
            episodeTitle,
            podcastTitle,
          },
          { preferDownloaded: isDownloadReady },
        );
      } else {
        await this.loadBook(
          transition.target.libraryItemId,
          { autoPlay: false },
          { preferDownloaded: isDownloadReady },
        );
      }
      await this.seekToImmediate(positionMs, {
        syncProgress: false,
        allowDuringPlaybackControlIntent: true,
      });
      if (shouldResumePlaying) {
        await this.performPlay({ applyAutoRewind: false });
      }
    } catch (error) {
      if (__DEV__) {
        console.warn("[player-service] playback-source-transition:failed", {
          target: transition.target,
          source: isDownloadReady ? "local" : "stream",
          error,
        });
      }
    }
  }

  private logQueue(context: string, queue: PlaybackQueueItem[]) {
    void context;
    void queue;
  }

  private logPlaybackResult(event: "started" | "failed", details?: Record<string, unknown>) {
    void event;
    void details;
  }

  async loadBook(
    libraryItemId: string,
    options?: { autoPlay?: boolean; suppressErrorState?: boolean },
    internalOptions?: { preferDownloaded?: boolean },
  ) {
    const suppressErrorState = options?.suppressErrorState ?? false;
    const existingState = playbackStore.getState();
    this.playbackTrace(
      `loadBook:start ${libraryItemId} (from=${existingState.libraryItemId ?? "none"})`,
    );
    const preferDownloaded = internalOptions?.preferDownloaded ?? true;
    let attemptedDownloadedAudio = false;
    // False until current playback has been torn down (or none existed). A
    // failure BEFORE teardown must leave the currently playing book fully
    // intact — resolving the new session first means a non-startable book
    // (e.g. streamed with no server URL on a headless CarPlay launch) fails
    // as a no-op instead of killing audio and leaving a zombie Now Playing.
    let tornDownExistingPlayback = false;

    if (__DEV__) {
      console.log("[player-service] loadBook:start", { libraryItemId });
    }

    try {
      const downloadedSession = preferDownloaded ? this.resolveDownloadedSession(libraryItemId) : null;
      const shouldUseDownloadedAudio = Boolean(downloadedSession);
      attemptedDownloadedAudio = shouldUseDownloadedAudio;
      let resolvedLibraryItemId = libraryItemId;
      let resolvedBookTitle: string | null = null;
      let resolvedSessionId = LOCAL_SESSION_ID;
      let queue: PlaybackQueueItem[] = [];
      let durationMs = 0;
      let chapterIndex: ReturnType<typeof buildChapterIndex> = [];

      // Preflight (current playback untouched): fetch the streamed session
      // BEFORE closing the active book so a failure keeps it playing.
      if (!downloadedSession && !this.canUseServer()) {
        throw new StreamedPlaybackStartFailureError(
          "Audiobookshelf is unreachable. Only downloaded audiobooks can play.",
        );
      }
      const streamedSession = downloadedSession
        ? null
        : await withPlaybackStartTimeout(playbackApi.getPlayInfo(libraryItemId));

      // Commit point — the new book is startable; NOW tear down the old one.
      const stateBeforeTransition = playbackStore.getState();
      if (
        stateBeforeTransition.libraryItemId &&
        stateBeforeTransition.libraryItemId !== libraryItemId &&
        stateBeforeTransition.queue.length > 0
      ) {
        await this.closeActiveBookForTransition();
        this.playbackTrace(`loadBook:transition-closed ${stateBeforeTransition.libraryItemId}`);
      }
      tornDownExistingPlayback = true;

      this.seedDisplayedResumePositionForLoad({
        candidateIds: this.buildCandidateIds(libraryItemId),
        cachedUserServerState: this.getCachedUserServerStateSnapshot().state,
        libraryItemId,
        durationMs: 0,
      });

      playbackStore.getState().actions.setPlaybackState("loading");
      playbackStore.getState().actions.setError(null);

      if (downloadedSession) {
        resolvedLibraryItemId = downloadedSession.libraryItemId;
        resolvedBookTitle = downloadedSession.bookTitle;
        resolvedSessionId = downloadedSession.sessionId;
        queue = downloadedSession.queue;
        durationMs = downloadedSession.durationMs;
        chapterIndex = downloadedSession.chapterIndex;
        this.logQueue("downloaded", queue);
      } else if (streamedSession) {
        resolvedLibraryItemId = streamedSession.libraryItem.id;
        resolvedBookTitle = streamedSession.libraryItem.media.metadata.title || "Unknown";
        resolvedSessionId = streamedSession.id;
        const builtQueue = buildPlaybackQueue(streamedSession);
        queue = builtQueue.queue;
        durationMs = builtQueue.durationMs;
        chapterIndex = buildChapterIndex(streamedSession.chapters, streamedSession.audioTracks);
        this.logQueue("streaming", queue);
      }

      const sessionKind = shouldUseDownloadedAudio ? "downloaded" : "streamed";
      this.playbackTrace(
        `loadBook:session-resolved ${resolvedLibraryItemId} kind=${sessionKind} tracks=${queue.length}`,
      );
      const rateCandidateIds = this.buildCandidateIds(resolvedLibraryItemId, libraryItemId);
      const cachedUserServerState = await this.getCachedUserServerState({
        fetchIfMissing: false,
      });
      this.seedDisplayedResumePositionForLoad({
        candidateIds: rateCandidateIds,
        cachedUserServerState: cachedUserServerState.state,
        libraryItemId: resolvedLibraryItemId,
        durationMs,
      });
      const freshServerProgressRequest = this.startFreshServerProgressFetch({
        libraryItemId: resolvedLibraryItemId,
        bookTitle: resolvedBookTitle,
        sessionKind,
      });
      const storedBookRate = this.resolveStoredBookRate(rateCandidateIds);
      const freshServerProgress = await this.awaitFreshServerProgressForLoad({
        request: freshServerProgressRequest,
        libraryItemId: resolvedLibraryItemId,
        bookTitle: resolvedBookTitle,
        sessionKind,
      });
      const resumePositionMs = this.resolveResumePositionMs({
        candidateIds: rateCandidateIds,
        cachedUserServerState: cachedUserServerState.state,
        freshServerProgress,
        libraryItemId: resolvedLibraryItemId,
        bookTitle: resolvedBookTitle,
        sessionKind,
        serverStateSource: cachedUserServerState.source,
      });
      const provisionalAutoRewindDecision =
        !shouldUseDownloadedAudio && options?.autoPlay
          ? this.consumeAutoRewindDecision({
              libraryItemId: resolvedLibraryItemId,
              positionMs: resumePositionMs,
              durationMs,
              chapterIndex,
              isFinished: durationMs > 0 && resumePositionMs >= durationMs - secondsToMs(3),
            })
          : null;
      const playbackStartPositionMs =
        provisionalAutoRewindDecision?.status === "applied"
          ? provisionalAutoRewindDecision.toPositionMs
          : resumePositionMs;
      displayedListeningPositionStore.getState().actions.setResumeResolution({
        libraryItemId: resolvedLibraryItemId,
        positionMs: playbackStartPositionMs,
        durationMs,
      });

      this.listenedMs = 0;
      this.lastSyncAttemptAt = 0;
      this.lastSyncAt = 0;
      this.lastTrackedPositionMs = 0;

      if (!shouldUseDownloadedAudio && options?.autoPlay) {
        await this.startProvisionalStreamedPlayback({
          libraryItemId: resolvedLibraryItemId,
          bookTitle: resolvedBookTitle,
          sessionId: resolvedSessionId,
          queue,
          durationMs,
          chapterIndex,
          resumePositionMs: playbackStartPositionMs,
          rate: storedBookRate,
          autoRewindDecision: provisionalAutoRewindDecision,
        });
        return;
      }

      playbackStore.getState().actions.setSession({
        libraryItemId: resolvedLibraryItemId,
        bookTitle: resolvedBookTitle,
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

      const targetTrack = findTrackForPosition(queue, playbackStartPositionMs) ?? queue[0];
      const targetIndex = queue.indexOf(targetTrack);
      const trackPositionMs = Math.max(0, playbackStartPositionMs - targetTrack.startOffsetMs);

      await this.loadTrack(targetIndex, { initialPositionMs: trackPositionMs });
      this.logSnapshot("after loadBook");
      this.playbackTrace(
        `loadBook:track-loaded ${resolvedLibraryItemId} track=${targetIndex} rate=${storedBookRate}`,
      );

      if (options?.autoPlay) {
        await this.performPlay();
        this.playbackTrace(
          `loadBook:play-result ${resolvedLibraryItemId} state=${playbackStore.getState().playbackState}`,
        );
        if (shouldUseDownloadedAudio) {
          const postPlayState = playbackStore.getState();
          if (postPlayState.playbackState !== "playing") {
            this.playbackTrace(
              `loadBook:downloaded-play-stalled ${resolvedLibraryItemId} → retry streamed`,
            );
            await this.loadBook(libraryItemId, options, { preferDownloaded: false });
            return;
          }
        }
      } else {
        playbackStore.getState().actions.setPlaybackState("ready");
      }
    } catch (error) {
      this.playbackTrace(
        `loadBook:error ${libraryItemId} ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!tornDownExistingPlayback) {
        // Preflight failure: the previously playing book is still fully
        // intact — do NOT reset playback state to error/idle over it. The
        // caller surfaces the failure (CarPlay alert / phone toast).
        this.playbackTrace(`loadBook:preflight-failed-kept-playing ${libraryItemId}`);
        if (suppressErrorState) return;
        throw error;
      }
      if (preferDownloaded && attemptedDownloadedAudio) {
        try {
          await this.loadBook(libraryItemId, options, { preferDownloaded: false });
          return;
        } catch (fallbackError) {
          if (isStreamedPlaybackStartFailure(fallbackError)) {
            throw fallbackError;
          }
          // Fall through to existing error handling.
        }
      }
      if (isStreamedPlaybackStartFailure(error)) {
        if (__DEV__) {
          console.log("[player-service] streamed-start-failure", { libraryItemId, error });
        }
        const playbackState = playbackStore.getState();
        if (playbackState.playbackState === "loading") {
          if (suppressErrorState) {
            // Best-effort restore: leave the player idle and keep the saved last
            // audiobook intact instead of surfacing a failed-start error.
            playbackState.actions.setPlaybackState("idle");
            playbackState.actions.setError(null);
          } else {
            playbackState.actions.resetAfterFailedStart({
              libraryItemId,
              bookTitle: null,
              positionMs: 0,
              rate: DEFAULT_BOOK_PLAYBACK_RATE,
              error: error instanceof Error ? error.message : "Unable to start streamed playback",
            });
          }
        }
        if (suppressErrorState) return;
        throw error;
      }
      if (__DEV__) {
        console.log("[player-service] loadBook:error", { libraryItemId, error });
      }
      const message = error instanceof Error ? error.message : "Unable to load book";
      const hasQueue = playbackStore.getState().queue.length > 0;
      if (suppressErrorState) {
        // Best-effort restore: idle (or keep a usable loaded queue) without an error banner.
        playbackStore.getState().actions.setPlaybackState(hasQueue ? "ready" : "idle");
        playbackStore.getState().actions.setError(null);
        return;
      }
      playbackStore.getState().actions.setPlaybackState(hasQueue ? "ready" : "error");
      playbackStore.getState().actions.setError(message);
      throw error;
    }
  }

  private async startProvisionalStreamedPlayback(payload: {
    libraryItemId: string;
    bookTitle: string | null;
    secondaryTitle?: string | null;
    episodeId?: string | null;
    sessionId: string;
    queue: PlaybackQueueItem[];
    durationMs: number;
    chapterIndex: ReturnType<typeof buildChapterIndex>;
    resumePositionMs: number;
    rate: number;
    autoRewindDecision?: AutoRewindDecision | null;
  }) {
    const targetTrack = findTrackForPosition(payload.queue, payload.resumePositionMs) ?? payload.queue[0];
    if (!targetTrack) {
      throw new Error("Track not found");
    }

    const attemptId = ++this.playbackStartAttemptId;
    const targetIndex = payload.queue.indexOf(targetTrack);
    const trackPositionMs = Math.max(0, payload.resumePositionMs - targetTrack.startOffsetMs);
    const bookPositionMs = targetTrack.startOffsetMs + trackPositionMs;
    const chapterAtPosition = findChapterForPosition(payload.chapterIndex, bookPositionMs);

    try {
      await withPlaybackStartTimeout(
        (async () => {
          await this.engine.load(targetTrack, {
            initialPositionMs: trackPositionMs,
            rate: payload.rate,
            pitchCorrectionQuality: settingsStore.getState().pitchCorrectionQuality,
          });

          await this.engine.play();
          try {
            await this.engine.waitForPlaying();
          } catch {
            await this.engine.play();
            await this.engine.waitForPlaying();
          }

          await this.engine.setRate(
            payload.rate,
            settingsStore.getState().pitchCorrectionQuality,
          );
        })(),
      );

      if (attemptId !== this.playbackStartAttemptId) {
        throw new StreamedPlaybackStartFailureError("Streamed playback start attempt was superseded");
      }

      playbackStore.getState().actions.commitStartedSession({
        libraryItemId: payload.libraryItemId,
        bookTitle: payload.bookTitle,
        secondaryTitle: payload.secondaryTitle ?? null,
        episodeId: payload.episodeId ?? null,
        sessionId: payload.sessionId,
        queue: payload.queue,
        durationMs: payload.durationMs,
        chapterIndex: payload.chapterIndex,
        currentTrackIndex: targetIndex,
        positionMs: bookPositionMs,
        trackPositionMs,
        rate: payload.rate,
        currentChapterId: chapterAtPosition?.id ?? null,
        trackDurationMs: targetTrack.durationMs,
      });
      displayedListeningPositionStore.getState().actions.markPlaybackProgress({
        libraryItemId: payload.libraryItemId,
        positionMs: bookPositionMs,
        durationMs: payload.durationMs,
        isFinished: payload.durationMs > 0 && bookPositionMs >= payload.durationMs - secondsToMs(3),
      });

      this.lastTrackedPositionMs = bookPositionMs;
      this.lastSyncAttemptAt = Date.now();
      if (payload.autoRewindDecision?.status === "applied") {
        this.runPlaybackFollowUp("auto-rewind-progress-sync", () =>
          this.syncProgress("auto_rewind", {
            state: playbackStore.getState(),
          }),
        );
      }
      if (!payload.episodeId) {
        this.touchUserServerStateCacheForPlayStart();
      }
      this.logPlaybackResult("started");
    } catch (error) {
      this.playbackStartAttemptId += 1;
      await this.resetAfterStreamedPlaybackStartFailure({
        libraryItemId: payload.libraryItemId,
        bookTitle: payload.bookTitle,
        sessionId: payload.sessionId,
        currentTimeMs: payload.resumePositionMs,
        durationMs: payload.durationMs,
        rate: payload.rate,
        errorMessage: error instanceof Error ? error.message : "Unable to start streamed playback",
      });
      this.logPlaybackResult("failed", {
        reason: error instanceof Error ? error.message : "Unable to start streamed playback",
        mode: "streaming",
        snapshot: this.engine.getDebugSnapshot(),
      });
      if (isStreamedPlaybackStartFailure(error)) {
        throw error;
      }
      throw new StreamedPlaybackStartFailureError();
    }
  }

  private async resetAfterStreamedPlaybackStartFailure(payload: {
    libraryItemId: string;
    bookTitle: string | null;
    sessionId: string;
    currentTimeMs: number;
    durationMs: number;
    rate: number;
    errorMessage: string;
  }) {
    try {
      await this.engine.unload();
    } catch (error) {
      if (__DEV__) {
        console.warn("[player-service] streamed-start-failure:unload-failed", { error });
      }
    }

    const preservedPositionMs = this.resolveProgressFloorMsForFailedStart(
      payload.libraryItemId,
      payload.currentTimeMs,
    );
    playbackStore.getState().actions.resetAfterFailedStart({
      libraryItemId: payload.libraryItemId,
      bookTitle: payload.bookTitle,
      positionMs: preservedPositionMs,
      rate: payload.rate,
      error: payload.errorMessage,
    });
    this.listenedMs = 0;
    this.lastSyncAttemptAt = 0;
    this.lastSyncAt = 0;
    this.lastTrackedPositionMs = preservedPositionMs;

    const closeCurrentTimeSeconds = msToSeconds(preservedPositionMs);
    if (closeCurrentTimeSeconds <= 0) {
      if (__DEV__) {
        console.warn("[player-service] streamed-start-failure:skip-zero-close-session", {
          sessionId: payload.sessionId,
          libraryItemId: payload.libraryItemId,
        });
      }
      return;
    }

    void sessionsApi
      .closeSession(payload.sessionId, {
        timeListened: 0,
        currentTime: closeCurrentTimeSeconds,
        duration: msToSeconds(payload.durationMs),
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn("[player-service] streamed-start-failure:close-session-failed", {
            sessionId: payload.sessionId,
            libraryItemId: payload.libraryItemId,
            currentTimeSeconds: closeCurrentTimeSeconds,
            error,
          });
        }
      });
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
    const existingState = playbackStore.getState();
    if (
      existingState.libraryItemId &&
      existingState.libraryItemId !== payload.libraryItemId &&
      existingState.queue.length > 0
    ) {
      await this.closeActiveBookForTransition();
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
      bookTitle: payload.title,
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
      await this.performPlay();
    } else {
      playbackStore.getState().actions.setPlaybackState("ready");
    }
  }

  private buildCandidateIds(...ids: (string | null | undefined)[]) {
    return ids
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .filter((value, index, source) => source.indexOf(value) === index);
  }

  private shouldPersistProgressOnClose(state: PlaybackStoreState) {
    const isStreamingSession = Boolean(state.sessionId && state.sessionId !== LOCAL_SESSION_ID);
    return (
      state.playbackState === "playing" ||
      (state.playbackState === "paused" && isStreamingSession)
    );
  }

  private async unloadAndResetPlayback(options?: { preservePlaybackControlIntent?: boolean }) {
    this.cancelPendingSkipBurst();
    const preservedPlaybackControlIntent = options?.preservePlaybackControlIntent
      ? playbackStore.getState().playbackControlIntent
      : null;
    try {
      await this.engine.unload();
    } catch (error) {
      if (__DEV__) {
        console.warn("[player-service] unload:failed-during-close", { error });
      }
    }

    playbackStore.getState().actions.reset();
    displayedListeningPositionStore.getState().actions.clearAll();
    if (preservedPlaybackControlIntent) {
      playbackStore.getState().actions.setPlaybackControlIntent(preservedPlaybackControlIntent);
    }
    this.listenedMs = 0;
    this.lastSyncAttemptAt = 0;
    this.lastSyncAt = 0;
    this.lastTrackedPositionMs = 0;
  }

  private async closeActiveBookForTransition() {
    await this.flushPendingSkipBurstBeforeExit();
    const state = playbackStore.getState();
    if (!state.queue.length) {
      await this.unloadAndResetPlayback();
      return;
    }

    const shouldPersistProgress = this.shouldPersistProgressOnClose(state);
    const shouldCloseStreamSession =
      state.sessionId !== null &&
      state.sessionId !== LOCAL_SESSION_ID &&
      (state.playbackState === "playing" || state.playbackState === "paused");

    if (state.playbackState === "playing") {
      this.recordListeningInterruptionForState(state);
      try {
        await this.engine.pause();
      } catch (error) {
        if (__DEV__) {
          console.warn("[player-service] close:pause-before-transition-failed", {
            libraryItemId: state.libraryItemId,
            error,
          });
        }
      }
      playbackStore.getState().actions.setPlaybackState("paused");
    }

    if (shouldPersistProgress) {
      const closingState = playbackStore.getState();
      this.runPlaybackFollowUp("close-progress-sync", () =>
        this.syncProgress("close", {
          state: closingState,
          closeStreamSession: shouldCloseStreamSession,
          forceDirectProgressUpdate: true,
        }),
      );
    }

    await this.unloadAndResetPlayback({ preservePlaybackControlIntent: true });
  }

  async endActivePlaybackForLogout() {
    await this.flushPendingSkipBurstBeforeExit();
    const state = playbackStore.getState();
    if (!state.queue.length) {
      await this.unloadAndResetPlayback();
      return;
    }

    const userKey = resolveListeningOwnerKey(state.libraryItemId);
    if (!userKey || !state.libraryItemId) {
      await this.unloadAndResetPlayback();
      return;
    }

    const shouldCloseStreamSession =
      state.sessionId !== null &&
      state.sessionId !== LOCAL_SESSION_ID &&
      (state.playbackState === "playing" || state.playbackState === "paused");
    const currentTimeSeconds = msToSeconds(state.positionMs);
    const cachedProgress = this.getCachedProgressForLibraryItem(state.libraryItemId);
    const queuedProgress =
      deviceBooksStore.getState().pendingProgressByUser[userKey]?.[state.libraryItemId];
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);
    const hasMeaningfulProgress =
      currentTimeSeconds > 0 ||
      isFinished ||
      Math.max(0, Math.floor(cachedProgress?.currentTime ?? 0)) > 0 ||
      Math.max(0, Math.floor(queuedProgress?.currentTime ?? 0)) > 0;

    if (state.playbackState === "playing") {
      try {
        await this.engine.pause();
      } catch (error) {
        if (__DEV__) {
          console.warn("[player-service] logout:pause-before-reset-failed", {
            libraryItemId: state.libraryItemId,
            error,
          });
        }
      }
      playbackStore.getState().actions.setPlaybackState("paused");
    }

    if (hasMeaningfulProgress) {
      await this.syncProgress("logout", {
        state: playbackStore.getState(),
        closeStreamSession: shouldCloseStreamSession,
        forceDirectProgressUpdate: true,
      });
    } else if (shouldCloseStreamSession && state.sessionId) {
      await sessionsApi
        .closeSession(state.sessionId, {
          timeListened: msToSeconds(this.listenedMs),
          currentTime: currentTimeSeconds,
          duration: msToSeconds(state.durationMs) || undefined,
        })
        .catch(() => undefined);
    }

    await this.unloadAndResetPlayback();
  }

  async endActivePlaybackForLibrarySwitch() {
    await this.closeActiveBookForTransition();
  }

  private resolveStoredBookRate(rateCandidateIds: string[]) {
    return this.resolveStoredBookRateIfAvailable(rateCandidateIds) ?? DEFAULT_BOOK_PLAYBACK_RATE;
  }

  private resolveStoredBookRateIfAvailable(rateCandidateIds: string[]) {
    if (!rateCandidateIds.length) {
      return null;
    }
    const deviceBooksState = deviceBooksStore.getState();
    const userKey = this.resolveUserKeyForLibraryItem(rateCandidateIds[0]);
    const storedRateCandidate = rateCandidateIds
      .map((candidateId) => ({
        candidateId,
        rate: selectBookPlaybackRateIfStored(deviceBooksState, candidateId, userKey),
      }))
      .find(
        (candidate): candidate is { candidateId: string; rate: number } =>
          candidate.rate !== null,
      );
    if (storedRateCandidate) {
      const normalizedRate = clampPlaybackRate(storedRateCandidate.rate);
      if (Math.abs(normalizedRate - storedRateCandidate.rate) > 0.0001) {
        deviceBooksStore.getState().actions.setBookPlaybackRate(
          storedRateCandidate.candidateId,
          normalizedRate,
          { userKey },
        );
      }
      return normalizedRate;
    }
    const fallbackRate = selectBookPlaybackRate(deviceBooksState, rateCandidateIds[0], userKey);
    return typeof fallbackRate === "number" ? clampPlaybackRate(fallbackRate) : null;
  }

  private resolveUserKeyForLibraryItem(libraryItemId: string | null | undefined) {
    return resolveListeningOwnerKey(libraryItemId);
  }

  private recordListeningInterruptionForState(state: PlaybackStoreState, startedAtMs = Date.now()) {
    if (!settingsStore.getState().autoRewindEnabled) return;
    if (!state.libraryItemId) return;
    deviceBooksStore.getState().actions.recordListeningInterruption(
      state.libraryItemId,
      startedAtMs,
      {
        userKey: this.resolveUserKeyForLibraryItem(state.libraryItemId),
      },
    );
  }

  private consumeAutoRewindDecision(payload: {
    libraryItemId: string;
    positionMs: number;
    durationMs: number;
    chapterIndex: PlaybackStoreState["chapterIndex"];
    isFinished: boolean;
  }): AutoRewindDecision {
    const settings = settingsStore.getState();
    if (!settings.autoRewindEnabled) {
      return { status: "disabled" };
    }

    const interruption = deviceBooksStore.getState().actions.consumeListeningInterruption(
      payload.libraryItemId,
      {
        userKey: this.resolveUserKeyForLibraryItem(payload.libraryItemId),
      },
    );

    return resolveAutoRewindDecision({
      enabled: settings.autoRewindEnabled,
      rules: settings.autoRewindRules,
      interruptionStartedAtMs: interruption?.startedAtMs ?? null,
      nowMs: Date.now(),
      positionMs: payload.positionMs,
      durationMs: payload.durationMs,
      chapters: payload.chapterIndex,
      limitToChapter: settings.autoRewindLimitToChapter,
      isFinished: payload.isFinished,
    });
  }

  private async applyAutoRewindBeforePlay(state: PlaybackStoreState) {
    if (!state.libraryItemId || !state.queue.length) return null;
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);
    const decision = this.consumeAutoRewindDecision({
      libraryItemId: state.libraryItemId,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
      chapterIndex: state.chapterIndex,
      isFinished,
    });

    if (decision.status !== "applied") {
      return decision;
    }

    if (decision.toPositionMs !== decision.fromPositionMs) {
      await this.seekToImmediate(decision.toPositionMs, {
        confirmDisplayedPosition: true,
        rollbackOptimisticPositionMs: decision.toPositionMs,
        syncProgress: true,
        allowDuringPlaybackControlIntent: true,
        progressSyncReason: "auto_rewind",
      });
    } else {
      await this.syncProgress("auto_rewind");
    }

    return decision;
  }

  private resolvePreferredRateForState(state: PlaybackStoreState) {
    const rateCandidateIds = this.buildCandidateIds(state.libraryItemId);
    return (
      this.resolveStoredBookRateIfAvailable(rateCandidateIds) ??
      clampPlaybackRate(state.rate ?? DEFAULT_BOOK_PLAYBACK_RATE)
    );
  }

  private resolveSessionKind(sessionId: string | null): ProgressLogSessionKind {
    if (!sessionId) return "unknown";
    return sessionId === LOCAL_SESSION_ID ? "downloaded" : "streamed";
  }

  private resolveBookTitle(state: Pick<PlaybackStoreState, "bookTitle" | "queue">) {
    return state.bookTitle ?? state.queue[0]?.title ?? null;
  }

  private shouldFetchFreshServerProgressForLoad() {
    return this.canUseServer();
  }

  private canUseServer() {
    const authState = authStore.getState();
    return (
      authState.status === "authenticated" &&
      canUseAudiobookshelfServer({
        isOnline: authState.isOnline,
        serverConnectionStatus: authState.serverConnectionStatus,
      })
    );
  }

  private logFreshServerProgressFetch(payload: {
    libraryItemId: string;
    bookTitle: string | null;
    sessionKind: ProgressLogSessionKind;
    trigger: string;
    result: ServerProgressFetchResult;
    fetchedCurrentTimeSeconds: number | null;
    cachedCurrentTimeSeconds: number | null;
    fetchedLastUpdate: number | null;
    cachedLastUpdate: number | null;
    errorMessage?: string;
    note?: string;
  }) {
    progressLogStore.getState().actions.appendEntry({
      eventType: "server_progress_fetch",
      trigger: payload.trigger,
      libraryItemId: payload.libraryItemId,
      title: payload.bookTitle,
      sessionKind: payload.sessionKind,
      result: payload.result,
      fetchedCurrentTimeSeconds: payload.fetchedCurrentTimeSeconds,
      cachedCurrentTimeSeconds: payload.cachedCurrentTimeSeconds,
      fetchedLastUpdate: payload.fetchedLastUpdate,
      cachedLastUpdate: payload.cachedLastUpdate,
      errorMessage: payload.errorMessage,
      note: payload.note,
    });
  }

  private applyServerProgressSnapshotToCache(
    libraryItemId: string,
    serverProgress: Awaited<ReturnType<typeof meApi.getProgress>>,
  ) {
    if (typeof serverProgress.currentTime !== "number") {
      return {
        status: "applied" as const,
        progress: serverProgress,
        cachedCurrentTimeSeconds: 0,
        cachedLastUpdate: 0,
      };
    }

    const resolvedLibraryItemId = serverProgress.libraryItemId || libraryItemId;
    const cachedProgress = this.getCachedProgressForLibraryItem(resolvedLibraryItemId);
    const cachedCurrentTimeSeconds = Math.max(0, Math.floor(cachedProgress?.currentTime ?? 0));
    const serverCurrentTimeSeconds = Math.max(0, Math.floor(serverProgress.currentTime));
    const serverLastUpdate = Math.max(0, Math.floor(serverProgress.lastUpdate ?? 0));
    const cachedLastUpdate = Math.max(0, Math.floor(cachedProgress?.lastUpdate ?? 0));
    const serverSnapshotIsOlder =
      cachedLastUpdate > 0 && serverLastUpdate > 0 && serverLastUpdate < cachedLastUpdate;
    const serverWouldRegressProgress =
      cachedCurrentTimeSeconds >
      serverCurrentTimeSeconds + PLAY_START_PROGRESS_FLOOR_TOLERANCE_SECONDS;
    const serverFreshnessUnknown = serverLastUpdate <= 0;
    const shouldIgnoreStaleServerSnapshot =
      !serverProgress.isFinished &&
      serverWouldRegressProgress &&
      (serverSnapshotIsOlder || serverFreshnessUnknown);

    if (shouldIgnoreStaleServerSnapshot) {
      return {
        status: "ignored_as_stale" as const,
        progress: serverProgress,
        cachedCurrentTimeSeconds,
        cachedLastUpdate,
      };
    }

    this.updateUserServerStateCache({
      libraryItemId: resolvedLibraryItemId,
      currentTimeSeconds: serverCurrentTimeSeconds,
      durationSeconds: Math.max(
        Math.max(0, Math.floor(serverProgress.duration ?? 0)),
        Math.max(0, Math.floor(cachedProgress?.duration ?? 0)),
      ),
      isFinished: Boolean(serverProgress.isFinished),
    });

    return {
      status: "applied" as const,
      progress: serverProgress,
      cachedCurrentTimeSeconds,
      cachedLastUpdate,
    };
  }

  private startFreshServerProgressFetch(payload: {
    libraryItemId: string;
    bookTitle: string | null;
    sessionKind: ProgressLogSessionKind;
  }) {
    if (!this.shouldFetchFreshServerProgressForLoad()) {
      return null;
    }

    return meApi
      .getProgress(payload.libraryItemId)
      .then((serverProgress) => {
        const result = this.applyServerProgressSnapshotToCache(
          payload.libraryItemId,
          serverProgress,
        );
        if (result.status === "applied" && typeof serverProgress.currentTime === "number") {
          displayedListeningPositionStore.getState().actions.acceptFreshServerProgress({
            libraryItemId: serverProgress.libraryItemId || payload.libraryItemId,
            positionMs: secondsToMs(Math.max(0, Math.floor(serverProgress.currentTime))),
            durationMs:
              typeof serverProgress.duration === "number"
                ? secondsToMs(Math.max(0, Math.floor(serverProgress.duration)))
                : undefined,
            isFinished: Boolean(serverProgress.isFinished),
          });
        }
        this.logFreshServerProgressFetch({
          libraryItemId: payload.libraryItemId,
          bookTitle: payload.bookTitle,
          sessionKind: payload.sessionKind,
          trigger: "load_book",
          result: result.status,
          fetchedCurrentTimeSeconds:
            typeof serverProgress.currentTime === "number"
              ? Math.max(0, Math.floor(serverProgress.currentTime))
              : null,
          cachedCurrentTimeSeconds: result.cachedCurrentTimeSeconds,
          fetchedLastUpdate:
            typeof serverProgress.lastUpdate === "number"
              ? Math.max(0, Math.floor(serverProgress.lastUpdate))
              : null,
          cachedLastUpdate: result.cachedLastUpdate,
          note:
            result.status === "applied"
              ? "Fresh server progress merged into the persisted query cache"
              : "Fresh server progress was ignored because cached progress looked newer",
        });
        return result;
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : "Fresh server progress request failed";
        this.logFreshServerProgressFetch({
          libraryItemId: payload.libraryItemId,
          bookTitle: payload.bookTitle,
          sessionKind: payload.sessionKind,
          trigger: "load_book",
          result: "failed",
          fetchedCurrentTimeSeconds: null,
          cachedCurrentTimeSeconds: null,
          fetchedLastUpdate: null,
          cachedLastUpdate: null,
          errorMessage,
        });
        return { status: "failed", errorMessage } as FreshServerProgressFetchResultPayload;
      });
  }

  private async awaitFreshServerProgressForLoad(
    payload: {
      request: Promise<FreshServerProgressFetchResultPayload> | null;
      libraryItemId: string;
      bookTitle: string | null;
      sessionKind: ProgressLogSessionKind;
    },
  ) {
    if (!payload.request) {
      return null;
    }

    const result = await Promise.race([
      payload.request,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOAD_PROGRESS_FETCH_TIMEOUT_MS)),
    ]);

    if (!result) {
      this.logFreshServerProgressFetch({
        libraryItemId: payload.libraryItemId,
        bookTitle: payload.bookTitle,
        sessionKind: payload.sessionKind,
        trigger: "load_book",
        result: "timed_out",
        fetchedCurrentTimeSeconds: null,
        cachedCurrentTimeSeconds: null,
        fetchedLastUpdate: null,
        cachedLastUpdate: null,
        note: `Fresh server progress did not return within ${LOAD_PROGRESS_FETCH_TIMEOUT_MS}ms`,
      });
      return null;
    }

    return result.status === "applied" ? result.progress : null;
  }

  private async reconcilePlaybackRate(reason: "play" | "status-transition") {
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    const preferredRate = this.resolvePreferredRateForState(state);
    if (Math.abs(state.rate - preferredRate) > 0.0001) {
      playbackStore.getState().actions.setRate(preferredRate);
      if (state.libraryItemId) {
        deviceBooksStore.getState().actions.setBookPlaybackRate(state.libraryItemId, preferredRate, {
          userKey: this.resolveUserKeyForLibraryItem(state.libraryItemId),
        });
      }
    }

    try {
      await this.engine.setRate(preferredRate, settingsStore.getState().pitchCorrectionQuality);
    } catch (error) {
      if (__DEV__) {
        console.warn("[player-service] rate:reconcile-failed", {
          reason,
          libraryItemId: state.libraryItemId,
          preferredRate,
          error,
        });
      }
    }
  }

  private async getCachedUserServerState(options?: {
    fetchIfMissing?: boolean;
  }): Promise<{
    state: UserServerState | undefined;
    source: CachedUserServerStateSource;
  }> {
    const { fetchIfMissing = false } = options ?? {};
    const cachedSnapshot = this.getCachedUserServerStateSnapshot();
    if (cachedSnapshot.state || !fetchIfMissing || cachedSnapshot.source === "unavailable") {
      return {
        state: cachedSnapshot.state,
        source: cachedSnapshot.source,
      };
    }

    try {
      const cachedUserServerState = await queryClient.fetchQuery({
        queryKey: cachedSnapshot.queryKey,
        queryFn: () =>
          fetchReconciledUserServerState(queryClient, cachedSnapshot.activeLibraryUserKey),
        meta: { persist: true },
      });
      return { state: cachedUserServerState, source: "fetch_success" };
    } catch {
      return { state: undefined, source: "fetch_failed" as CachedUserServerStateSource };
    }
  }

  private getCachedUserServerStateSnapshot() {
    const activeLibraryUserKey = authStore.getState().activeLibraryUserKey;
    const queryKey = queryKeys.userServerState(activeLibraryUserKey ?? "");
    if (!activeLibraryUserKey) {
      return {
        state: undefined,
        source: "unavailable" as CachedUserServerStateSource,
        activeLibraryUserKey: "",
        queryKey,
      };
    }

    const cachedUserServerState = queryClient.getQueryData<UserServerState>(queryKey);
    return {
      state: cachedUserServerState,
      source: cachedUserServerState
        ? ("cache_hit" as CachedUserServerStateSource)
        : ("skipped_fetch" as CachedUserServerStateSource),
      activeLibraryUserKey,
      queryKey,
    };
  }

  private getQueuedProgressForCandidateIds(candidateIds: string[]) {
    const { activeLibraryUserKey, storedUserId } = authStore.getState();
    const resolvedUserKey =
      activeLibraryUserKey ??
      storedUserId ??
      candidateIds
        .map(
          (candidateId) =>
            deviceBooksStore.getState().downloadedOwnerUserIdsById[candidateId]?.[0] ?? null,
        )
        .find((ownerUserId): ownerUserId is string => Boolean(ownerUserId));
    if (!resolvedUserKey) {
      return null;
    }

    const queueByItemId = deviceBooksStore.getState().pendingProgressByUser[resolvedUserKey] ?? {};
    const directQueuedProgress = candidateIds
      .map((candidateId) => queueByItemId[candidateId])
      .find((progress): progress is PendingProgressSync => Boolean(progress));
    if (directQueuedProgress) {
      return directQueuedProgress;
    }

    return pickNewestQueuedProgress(
      Object.values(queueByItemId).filter((progress) => candidateIds.includes(progress.libraryItemId)),
    );
  }

  private getCachedProgressForCandidateIds(
    candidateIds: string[],
    cachedUserServerState?: UserServerState,
  ) {
    const progressByLibraryItemId =
      cachedUserServerState?.progressByLibraryItemId ??
      // Compatibility for older persisted query shape.
      (
        cachedUserServerState as UserServerState & {
          progressByBookId?: UserServerState["progressByLibraryItemId"];
        }
      )?.progressByBookId ??
      {};

    const directCachedUserProgress = candidateIds
      .map((candidateId) => progressByLibraryItemId[candidateId])
      .find((progress) => typeof progress?.currentTime === "number");
    const fallbackCachedUserProgress = pickNewestProgress(
      Object.values(progressByLibraryItemId).filter((progress) => {
        if (!progress || typeof progress.currentTime !== "number") return false;
        const libraryItemId = progress.libraryItemId;
        const mediaItemId = progress.mediaItemId;
        return (
          (typeof libraryItemId === "string" && candidateIds.includes(libraryItemId)) ||
          (typeof mediaItemId === "string" && candidateIds.includes(mediaItemId))
        );
      }),
    );

    return directCachedUserProgress ?? fallbackCachedUserProgress;
  }

  private seedDisplayedResumePositionForLoad(payload: {
    candidateIds: string[];
    cachedUserServerState?: UserServerState;
    libraryItemId: string;
    durationMs: number;
  }) {
    const cachedUserProgress = this.getCachedProgressForCandidateIds(
      payload.candidateIds,
      payload.cachedUserServerState,
    );
    const carPlayResumeSnapshot = getCarPlayResumeSnapshotForCandidateIds(
      payload.candidateIds,
    );
    const queuedProgress = this.getQueuedProgressForCandidateIds(payload.candidateIds);
    const persisted = playbackStore.getState();
    const persistedPositionMs = payload.candidateIds.some(
      (candidateId) => persisted.libraryItemId === candidateId,
    )
      ? persisted.positionMs
      : 0;
    const cachedCurrentTimeSeconds =
      typeof cachedUserProgress?.currentTime === "number"
        ? Math.max(0, Math.floor(cachedUserProgress.currentTime))
        : null;
    const queuedCurrentTimeSeconds =
      typeof queuedProgress?.currentTime === "number"
        ? Math.max(0, Math.floor(queuedProgress.currentTime))
        : null;
    const carPlayCurrentTimeSeconds =
      typeof carPlayResumeSnapshot?.currentTimeSeconds === "number"
        ? Math.max(0, Math.floor(carPlayResumeSnapshot.currentTimeSeconds))
        : null;
    const persistedCurrentTimeSeconds =
      persistedPositionMs > 0 ? msToSeconds(persistedPositionMs) : null;
    const bestServerCurrentTimeSeconds = cachedCurrentTimeSeconds ?? 0;
    const serverWouldBeatQueuedZero =
      !queuedProgress?.isFinished &&
      (queuedCurrentTimeSeconds ?? 0) <= 0 &&
      bestServerCurrentTimeSeconds > STALE_ZERO_PROGRESS_GUARD_SECONDS;
    const candidates: ProgressResolutionCandidate[] = [
      {
        source: "persisted_query_cache",
        available: cachedCurrentTimeSeconds !== null,
        currentTimeSeconds: cachedCurrentTimeSeconds,
        durationSeconds:
          typeof cachedUserProgress?.duration === "number"
            ? Math.max(0, Math.floor(cachedUserProgress.duration))
            : null,
        isFinished:
          typeof cachedUserProgress?.isFinished === "boolean" ? cachedUserProgress.isFinished : null,
        lastUpdate:
          typeof cachedUserProgress?.lastUpdate === "number"
            ? Math.max(0, Math.floor(cachedUserProgress.lastUpdate))
            : null,
        note: "Seeded from cached user server state before fresh server progress returned",
      },
      {
        source: "carplay_resume_snapshot",
        available: carPlayCurrentTimeSeconds !== null,
        currentTimeSeconds: carPlayCurrentTimeSeconds,
        durationSeconds:
          typeof carPlayResumeSnapshot?.durationSeconds === "number"
            ? Math.max(0, Math.floor(carPlayResumeSnapshot.durationSeconds))
            : null,
        isFinished:
          typeof carPlayResumeSnapshot?.isFinished === "boolean"
            ? carPlayResumeSnapshot.isFinished
            : null,
        lastUpdate:
          typeof carPlayResumeSnapshot?.updatedAt === "number"
            ? Math.max(0, Math.floor(carPlayResumeSnapshot.updatedAt))
            : null,
        note: "Seeded from CarPlay's local per-book resume snapshot",
      },
      {
        source: "queue",
        available: queuedCurrentTimeSeconds !== null,
        currentTimeSeconds: queuedCurrentTimeSeconds,
        durationSeconds: null,
        isFinished: typeof queuedProgress?.isFinished === "boolean" ? queuedProgress.isFinished : null,
        lastUpdate:
          typeof queuedProgress?.updatedAt === "number"
            ? Math.max(0, Math.floor(queuedProgress.updatedAt))
            : null,
        note: serverWouldBeatQueuedZero
          ? "Ignored as a stale queued zero-progress entry"
          : "Seeded from pending local queued progress",
      },
      {
        source: "persisted_playback",
        available: persistedCurrentTimeSeconds !== null,
        currentTimeSeconds: persistedCurrentTimeSeconds,
        durationSeconds: persistedCurrentTimeSeconds,
        isFinished: null,
        lastUpdate: null,
        note: "Seeded from persisted playback-store position",
      },
    ];
    const chosenCandidate = chooseResumeResolutionCandidate(candidates, {
      ignoreQueue: serverWouldBeatQueuedZero,
    });
    const chosenCurrentTimeSeconds = Math.max(0, chosenCandidate?.currentTimeSeconds ?? 0);

    displayedListeningPositionStore.getState().actions.setResumeResolution({
      libraryItemId: payload.libraryItemId,
      positionMs: secondsToMs(chosenCurrentTimeSeconds),
      durationMs: Math.max(
        payload.durationMs,
        secondsToMs(Math.max(0, chosenCandidate?.durationSeconds ?? 0)),
      ),
      isFinished: Boolean(chosenCandidate?.isFinished),
    });
  }

  private resolveProgressFloorMsForFailedStart(libraryItemId: string, requestedPositionMs: number) {
    const candidateIds = this.buildCandidateIds(libraryItemId);
    const cachedProgress = this.getCachedProgressForLibraryItem(libraryItemId);
    const queuedProgress = this.getQueuedProgressForCandidateIds(candidateIds);
    const carPlayResumeSnapshot = getCarPlayResumeSnapshotForCandidateIds(candidateIds);
    const persisted = playbackStore.getState();
    const persistedPositionMs =
      persisted.libraryItemId === libraryItemId ? Math.max(0, persisted.positionMs) : 0;
    const cachedPositionMs = secondsToMs(
      Math.max(0, Math.floor(cachedProgress?.currentTime ?? 0)),
    );
    const queuedPositionMs = secondsToMs(
      Math.max(0, Math.floor(queuedProgress?.currentTime ?? 0)),
    );
    const carPlayPositionMs = secondsToMs(
      Math.max(0, Math.floor(carPlayResumeSnapshot?.currentTimeSeconds ?? 0)),
    );

    return Math.max(
      0,
      requestedPositionMs,
      persistedPositionMs,
      cachedPositionMs,
      carPlayPositionMs,
      queuedPositionMs,
    );
  }

  private resolveResumePositionMs(payload: {
    candidateIds: string[];
    cachedUserServerState?: UserServerState;
    freshServerProgress?: Awaited<ReturnType<typeof meApi.getProgress>> | null;
    libraryItemId: string;
    bookTitle: string | null;
    sessionKind: ProgressLogSessionKind;
    serverStateSource: CachedUserServerStateSource;
  }) {
    const {
      candidateIds,
      cachedUserServerState,
      freshServerProgress,
      libraryItemId,
      bookTitle,
      sessionKind,
      serverStateSource,
    } = payload;
    const cachedUserProgress = this.getCachedProgressForCandidateIds(
      candidateIds,
      cachedUserServerState,
    );
    const carPlayResumeSnapshot = getCarPlayResumeSnapshotForCandidateIds(candidateIds);
    const queuedProgress = this.getQueuedProgressForCandidateIds(candidateIds);

    const persisted = playbackStore.getState();
    const persistedPositionMs =
      candidateIds.some((candidateId) => persisted.libraryItemId === candidateId)
        ? persisted.positionMs
        : 0;
    const freshServerCurrentTimeSeconds =
      typeof freshServerProgress?.currentTime === "number"
        ? Math.max(0, Math.floor(freshServerProgress.currentTime))
        : null;
    const cachedServerCurrentTimeSeconds =
      typeof cachedUserProgress?.currentTime === "number"
        ? Math.max(0, Math.floor(cachedUserProgress.currentTime))
        : null;
    const bestServerCurrentTimeSeconds = Math.max(
      freshServerCurrentTimeSeconds ?? 0,
      cachedServerCurrentTimeSeconds ?? 0,
    );
    const queuedCurrentTimeSeconds =
      typeof queuedProgress?.currentTime === "number"
        ? Math.max(0, Math.floor(queuedProgress.currentTime))
        : null;
    const carPlayCurrentTimeSeconds =
      typeof carPlayResumeSnapshot?.currentTimeSeconds === "number"
        ? Math.max(0, Math.floor(carPlayResumeSnapshot.currentTimeSeconds))
        : null;
    const persistedCurrentTimeSeconds =
      persistedPositionMs > 0 ? msToSeconds(persistedPositionMs) : null;
    const serverWouldBeatQueuedZero =
      !queuedProgress?.isFinished &&
      (queuedCurrentTimeSeconds ?? 0) <= 0 &&
      bestServerCurrentTimeSeconds > STALE_ZERO_PROGRESS_GUARD_SECONDS;

    const candidates: ProgressResolutionCandidate[] = [
      {
        source: "fresh_server_fetch",
        available: freshServerCurrentTimeSeconds !== null,
        currentTimeSeconds: freshServerCurrentTimeSeconds,
        durationSeconds:
          typeof freshServerProgress?.duration === "number"
            ? Math.max(0, Math.floor(freshServerProgress.duration))
            : null,
        isFinished:
          typeof freshServerProgress?.isFinished === "boolean"
            ? freshServerProgress.isFinished
            : null,
        lastUpdate:
          typeof freshServerProgress?.lastUpdate === "number"
            ? Math.max(0, Math.floor(freshServerProgress.lastUpdate))
            : null,
        note:
          freshServerCurrentTimeSeconds !== null
            ? "Fetched from server during load before resume selection"
            : "Fresh server progress was unavailable within the load timeout",
      },
      {
        source: "persisted_query_cache",
        available: cachedServerCurrentTimeSeconds !== null,
        currentTimeSeconds: cachedServerCurrentTimeSeconds,
        durationSeconds:
          typeof cachedUserProgress?.duration === "number"
            ? Math.max(0, Math.floor(cachedUserProgress.duration))
            : null,
        isFinished:
          typeof cachedUserProgress?.isFinished === "boolean" ? cachedUserProgress.isFinished : null,
        lastUpdate:
          typeof cachedUserProgress?.lastUpdate === "number"
            ? Math.max(0, Math.floor(cachedUserProgress.lastUpdate))
            : null,
        note:
          serverStateSource === "cache_hit"
            ? "Loaded from cached user server state"
            : "No persisted React Query progress candidate was available",
      },
      {
        source: "carplay_resume_snapshot",
        available: carPlayCurrentTimeSeconds !== null,
        currentTimeSeconds: carPlayCurrentTimeSeconds,
        durationSeconds:
          typeof carPlayResumeSnapshot?.durationSeconds === "number"
            ? Math.max(0, Math.floor(carPlayResumeSnapshot.durationSeconds))
            : null,
        isFinished:
          typeof carPlayResumeSnapshot?.isFinished === "boolean"
            ? carPlayResumeSnapshot.isFinished
            : null,
        lastUpdate:
          typeof carPlayResumeSnapshot?.updatedAt === "number"
            ? Math.max(0, Math.floor(carPlayResumeSnapshot.updatedAt))
            : null,
        note: carPlayResumeSnapshot
          ? "CarPlay local per-book resume snapshot"
          : "No CarPlay resume snapshot was available",
      },
      {
        source: "queue",
        available: queuedCurrentTimeSeconds !== null,
        currentTimeSeconds: queuedCurrentTimeSeconds,
        durationSeconds: null,
        isFinished: typeof queuedProgress?.isFinished === "boolean" ? queuedProgress.isFinished : null,
        lastUpdate:
          typeof queuedProgress?.updatedAt === "number"
            ? Math.max(0, Math.floor(queuedProgress.updatedAt))
            : null,
        note: serverWouldBeatQueuedZero
          ? "Ignored as a stale queued zero-progress entry"
          : queuedProgress
            ? "Pending local queued progress"
            : "No queued progress candidate was available",
      },
      {
        source: "persisted_playback",
        available: persistedCurrentTimeSeconds !== null,
        currentTimeSeconds: persistedCurrentTimeSeconds,
        durationSeconds: persistedCurrentTimeSeconds,
        isFinished: null,
        lastUpdate: null,
        note:
          persistedCurrentTimeSeconds !== null
            ? "Persisted playback-store resume position"
            : "No persisted playback-store position was available",
      },
    ];

    const chosenCandidate = chooseResumeResolutionCandidate(candidates, {
      ignoreQueue: serverWouldBeatQueuedZero,
    });

    const chosenSource: ProgressResolutionSource = chosenCandidate?.source ?? "none";
    const chosenCurrentTimeSeconds = Math.max(0, chosenCandidate?.currentTimeSeconds ?? 0);
    const reason =
      chosenSource === "queue"
        ? bestServerCurrentTimeSeconds > 0 || persistedCurrentTimeSeconds !== null
          ? "Queued local progress was the furthest non-stale resume point"
          : "Queued local progress was the only available resume point"
        : chosenSource === "persisted_playback"
          ? "Persisted playback-store position was ahead of the other resume candidates"
          : chosenSource === "carplay_resume_snapshot"
            ? "CarPlay local resume snapshot was the best available resume point"
          : chosenSource === "fresh_server_fetch"
            ? "Fresh server progress was the best available resume point"
            : chosenSource === "persisted_query_cache"
              ? "Persisted React Query progress cache was the best available resume point"
            : "No saved progress was available";

    progressLogStore.getState().actions.appendEntry({
      eventType: "progress_resolution",
      trigger: "load_book",
      libraryItemId,
      title: bookTitle,
      sessionKind,
      serverStateSource,
      chosenSource,
      chosenCurrentTimeSeconds,
      reason,
      candidates,
    });

    return secondsToMs(chosenCurrentTimeSeconds);
  }

  private resolveDownloadedSession(libraryItemId: string): {
    libraryItemId: string;
    bookTitle: string;
    sessionId: string;
    queue: PlaybackQueueItem[];
    durationMs: number;
    chapterIndex: ReturnType<typeof buildChapterIndex>;
  } | null {
    const state = deviceBooksStore.getState();
    const details = state.downloadedDetailsById[libraryItemId];
    const downloadInfo = state.downloadedBookData[libraryItemId];
    if (!details || !downloadInfo?.audioTracks?.length) {
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
    const fallbackArtworkUri = (() => {
      try {
        const artworkUrls = buildCoverUrls(libraryItemId, {
          token: authStore.getState().accessToken,
          version: details.updatedAt,
        });
        return artworkUrls.fullWithToken ?? artworkUrls.full;
      } catch {
        return undefined;
      }
    })();
    const artworkUri = resolveStoredDownloadCoverUri(downloadInfo) ?? fallbackArtworkUri;
    const queue: PlaybackQueueItem[] = normalizedTracks
      .filter((track) => Boolean(resolveStoredDownloadTrackUri(track)))
      .map((track, trackIndex) =>
        this.toDownloadedQueueItem({
          libraryItemId,
          author,
          fallbackTitle,
          artworkUri,
          track,
          trackIndex,
          detailsTrack: detailsTrackByIno.get(track.ino),
        }),
      );
    if (!queue.length) {
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

    return {
      libraryItemId,
      bookTitle: fallbackTitle,
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
    artworkUri?: string;
    track: DownloadTrack & { normalizedStartOffset?: number; normalizedDuration?: number };
    trackIndex: number;
    detailsTrack?: {
      title?: string;
      mimeType?: string;
    };
  }): PlaybackQueueItem {
    const trackUri = resolveStoredDownloadTrackUri(payload.track);
    if (!trackUri) {
      throw new Error("Downloaded track path is unavailable in this build.");
    }

    return {
      id: `${payload.libraryItemId}-download-${payload.trackIndex}`,
      libraryItemId: payload.libraryItemId,
      sessionId: LOCAL_SESSION_ID,
      trackIndex: payload.trackIndex,
      // Book title, not the per-file track title: this string becomes the
      // Now Playing title on the lock screen and CarPlay, where a raw
      // filename like "01.mp3" is meaningless.
      title: payload.fallbackTitle,
      author: payload.author,
      artworkUri: payload.artworkUri,
      durationMs: secondsToMs(payload.track.normalizedDuration ?? payload.track.duration),
      startOffsetMs: secondsToMs(payload.track.normalizedStartOffset ?? payload.track.startOffset),
      source: {
        uri: trackUri,
        mimeType: payload.detailsTrack?.mimeType,
        isLocal: true,
      },
    };
  }

  private async performPlay(options?: {
    touchProgressCache?: boolean;
    updatePlaybackStore?: boolean;
    disableLocalStreamFallback?: boolean;
    applyAutoRewind?: boolean;
  }) {
    this.logDebug("play");
    const state = playbackStore.getState();
    if (!state.queue.length) return;
    if (options?.updatePlaybackStore !== false && options?.applyAutoRewind !== false) {
      await this.applyAutoRewindBeforePlay(state);
    }
    const playbackStateAfterAutoRewind = playbackStore.getState();
    const currentTrack =
      playbackStateAfterAutoRewind.queue[playbackStateAfterAutoRewind.currentTrackIndex];
    if (currentTrack && !currentTrack.source.isLocal && !this.canUseServer()) {
      throw new StreamedPlaybackStartFailureError(
        "Audiobookshelf is unreachable. Only downloaded audiobooks can play.",
      );
    }
    const shouldVerifyDownloadedPlayback =
      options?.updatePlaybackStore !== false && Boolean(currentTrack?.source.isLocal);

    try {
      await this.engine.play();
      this.playbackTrace("performPlay:waiting-for-playing");

      try {
        await this.engine.waitForPlaying({ timeoutMs: 15000 });
      } catch (waitError) {
        this.playbackTrace(
          `performPlay:playing-wait-retry ${waitError instanceof Error ? waitError.message : String(waitError)}`,
        );
        // Some devices can settle in PAUSED/STOPPED briefly after load.
        // Retry play once, then wait again before surfacing an error.
        await this.engine.play();
        await this.engine.waitForPlaying({ timeoutMs: 15000 });
      }
      this.playbackTrace("performPlay:playing-confirmed");

      this.logSnapshot("after play");
      if (options?.updatePlaybackStore !== false) {
        playbackStore.getState().actions.setPlaybackState("playing");
        playbackStore.getState().actions.setError(null);
      }
      // Arm interval sync from play start so we do not flush transient 0s immediately.
      this.lastSyncAttemptAt = Date.now();
      if (options?.updatePlaybackStore !== false && options?.touchProgressCache !== false) {
        this.runPlaybackFollowUp("touch-play-start-cache", () =>
          this.touchUserServerStateCacheForPlayStart(),
        );
      }
      if (shouldVerifyDownloadedPlayback) {
        this.runPlaybackFollowUp("downloaded-playback-progress-watchdog", () =>
          this.waitForDownloadedPlaybackProgress(),
        );
      }
      if (options?.updatePlaybackStore !== false) {
        this.runPlaybackFollowUp("playback-rate-reconcile", () =>
          this.reconcilePlaybackRate("play"),
        );
      }
      this.logPlaybackResult("started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start playback";
      const currentState = playbackStore.getState();
      const fallbackTarget = resolveLocalPlaybackFallbackTarget({
        libraryItemId: currentState.libraryItemId,
        episodeId: currentState.episodeId,
        sessionId: currentState.sessionId,
      });
      const shouldFallbackToStreaming =
        Boolean(fallbackTarget) &&
        !this.localStreamFallbackInFlight &&
        options?.disableLocalStreamFallback !== true &&
        this.canUseServer();

      if (shouldFallbackToStreaming && fallbackTarget) {
        this.localStreamFallbackInFlight = true;
        try {
          await runLocalPlaybackFallback(fallbackTarget, {
            loadEpisode: (target) =>
              this.loadEpisode(
                target.libraryItemId,
                target.episodeId,
                {
                  autoPlay: true,
                  episodeTitle: currentState.bookTitle,
                  podcastTitle: currentState.secondaryTitle,
                },
                { preferDownloaded: false },
              ),
            loadBook: (target) =>
              this.loadBook(target.libraryItemId, { autoPlay: true }, {
                preferDownloaded: false,
              }),
          });
          return;
        } catch (fallbackError) {
          if (isStreamedPlaybackStartFailure(fallbackError)) {
            throw fallbackError;
          }
        } finally {
          this.localStreamFallbackInFlight = false;
        }
      }

      if (options?.updatePlaybackStore !== false) {
        const finalState = playbackStore.getState();
        if (finalState.queue.length > 0) {
          playbackStore.getState().actions.setPlaybackState("ready");
        } else {
          playbackStore.getState().actions.setPlaybackState("error");
        }
        playbackStore.getState().actions.setError(message);
      }
      this.logPlaybackResult("failed", {
        reason: message,
        mode: currentState.sessionId === LOCAL_SESSION_ID ? "downloaded" : "streaming",
        snapshot: this.engine.getDebugSnapshot(),
      });
      if (options?.updatePlaybackStore === false) {
        throw error;
      }
    }
  }

  private getPauseSyncSignature(state: PlaybackStoreState) {
    if (!state.libraryItemId || !state.sessionId) return null;
    const currentTimeSeconds = msToSeconds(state.positionMs);
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);
    return `${state.libraryItemId}:${currentTimeSeconds}:${isFinished ? "finished" : "active"}`;
  }

  private async syncPauseLikeProgress(
    reason: Extract<ProgressSyncReason, "pause" | "external_pause">,
    options?: {
      state?: PlaybackStoreState;
    },
  ) {
    await this.flushPendingSkipBurstBeforeExit();
    const state = options?.state ?? playbackStore.getState();
    const signature = this.getPauseSyncSignature(state);
    const now = Date.now();
    if (!signature) {
      return { syncAttempted: false, dedupeSkipped: false };
    }

    const dedupeSkipped = Boolean(
      signature === this.lastPauseSyncSignature &&
        now - this.lastPauseSyncAt <= PAUSE_SYNC_DEDUPE_WINDOW_MS,
    );

    if (dedupeSkipped) {
      return { syncAttempted: false, dedupeSkipped };
    }

    this.lastPauseSyncSignature = signature;
    this.lastPauseSyncAt = now;
    await this.syncProgress(reason, { state });
    return { syncAttempted: true, dedupeSkipped: false };
  }

  private async performPause(options?: { syncProgress?: boolean; updatePlaybackStore?: boolean }) {
    this.logDebug("pause");
    await this.flushPendingSkipBurstBeforeExit();
    const stateBeforePause = playbackStore.getState();
    await this.engine.pause();
    this.logSnapshot("after pause");
    if (options?.updatePlaybackStore !== false) {
      playbackStore.getState().actions.setPlaybackState("paused");
    }
    if (options?.updatePlaybackStore !== false && stateBeforePause.playbackState === "playing") {
      this.recordListeningInterruptionForState(stateBeforePause);
    }
    if (options?.updatePlaybackStore !== false && options?.syncProgress !== false) {
      this.runPlaybackFollowUp("pause-progress-sync", () =>
        this.syncPauseLikeProgress("pause", { state: playbackStore.getState() }),
      );
    }
  }

  async requestStart(libraryItemId: string): Promise<PlaybackControlResult> {
    const state = playbackStore.getState();
    const accepted = this.beginPlaybackControlIntent({
      kind: "start",
      libraryItemId,
      requestedAudibleState: "playing",
    });
    if (accepted.status !== "accepted") return accepted;

    if (state.libraryItemId === libraryItemId && !state.episodeId && state.queue.length > 0) {
      if (state.playbackState === "playing") {
        this.finishPlaybackControlIntent(accepted.intentId);
        return { status: "already_satisfied", state: "playing" };
      }
      try {
        await this.performPlay();
        return accepted;
      } finally {
        this.finishPlaybackControlIntent(accepted.intentId);
      }
    }

    try {
      // Inside the try: a throw here would otherwise leak the intent and
      // block every subsequent playback control until it goes stale.
      this.seedDisplayedResumePositionForLoad({
        candidateIds: this.buildCandidateIds(libraryItemId),
        cachedUserServerState: this.getCachedUserServerStateSnapshot().state,
        libraryItemId,
        durationMs: 0,
      });
      await this.loadBook(libraryItemId, { autoPlay: true });
      return accepted;
    } finally {
      this.finishPlaybackControlIntent(accepted.intentId);
    }
  }

  async requestStartEpisode(
    libraryItemId: string,
    episodeId: string,
    options?: { episodeTitle?: string | null; podcastTitle?: string | null },
  ): Promise<PlaybackControlResult> {
    const state = playbackStore.getState();
    const accepted = this.beginPlaybackControlIntent({
      kind: "start",
      libraryItemId,
      episodeId,
      requestedAudibleState: "playing",
    });
    if (accepted.status !== "accepted") return accepted;

    if (
      state.libraryItemId === libraryItemId &&
      state.episodeId === episodeId &&
      state.queue.length > 0
    ) {
      if (state.playbackState === "playing") {
        this.finishPlaybackControlIntent(accepted.intentId);
        return { status: "already_satisfied", state: "playing" };
      }
      try {
        await this.performPlay();
        return accepted;
      } finally {
        this.finishPlaybackControlIntent(accepted.intentId);
      }
    }

    try {
      await this.loadEpisode(libraryItemId, episodeId, {
        autoPlay: true,
        episodeTitle: options?.episodeTitle,
        podcastTitle: options?.podcastTitle,
      });
      return accepted;
    } finally {
      this.finishPlaybackControlIntent(accepted.intentId);
    }
  }

  async loadEpisode(
    libraryItemId: string,
    episodeId: string,
    options?: {
      autoPlay?: boolean;
      suppressErrorState?: boolean;
      episodeTitle?: string | null;
      podcastTitle?: string | null;
    },
    internalOptions?: { preferDownloaded?: boolean },
  ) {
    const suppressErrorState = options?.suppressErrorState ?? false;
    const preferDownloaded = internalOptions?.preferDownloaded ?? true;
    let tornDownExistingPlayback = false;
    let attemptedDownloadedAudio = false;

    try {
      const downloadedEpisode =
        preferDownloaded
          ? resolveDownloadedEpisodePlayback({ libraryItemId, episodeId })
          : null;
      const playbackSource = resolveEpisodePlaybackSource({
        hasPlayableLocalDownload: Boolean(downloadedEpisode),
        canStream: this.canUseServer(),
      });
      if (playbackSource === "unavailable") {
        throw new StreamedPlaybackStartFailureError(
          "Audiobookshelf is unreachable. Only downloaded Episodes can play.",
        );
      }

      attemptedDownloadedAudio = playbackSource === "local";
      let streamedSession: Awaited<ReturnType<typeof playbackApi.getEpisodePlayInfo>> | null =
        null;
      if (playbackSource === "stream") {
        streamedSession = await withPlaybackStartTimeout(
          playbackApi.getEpisodePlayInfo(libraryItemId, episodeId),
        );
      }

      const stateBeforeTransition = playbackStore.getState();
      if (
        stateBeforeTransition.queue.length > 0 &&
        (stateBeforeTransition.libraryItemId !== libraryItemId ||
          stateBeforeTransition.episodeId !== episodeId)
      ) {
        await this.closeActiveBookForTransition();
      }
      tornDownExistingPlayback = true;

      playbackStore.getState().actions.setPlaybackState("loading");
      playbackStore.getState().actions.setError(null);

      // Episodes do not offer chapter list / CarPlay Up Next (ADR 0028).
      const chapterIndex: ReturnType<typeof buildChapterIndex> = [];
      let episodeTitle = options?.episodeTitle?.trim() || "Episode";
      let podcastTitle = options?.podcastTitle?.trim() || "Podcast";
      let queue: ReturnType<typeof buildPlaybackQueue>["queue"] = [];
      let durationMs = 0;
      let resolvedSessionId = LOCAL_SESSION_ID;

      if (downloadedEpisode) {
        episodeTitle =
          options?.episodeTitle?.trim() || downloadedEpisode.episodeTitle || episodeTitle;
        podcastTitle =
          options?.podcastTitle?.trim() || downloadedEpisode.podcastTitle || podcastTitle;
        durationMs = secondsToMs(downloadedEpisode.durationSeconds);
        const trackUri =
          resolveStoredEpisodeDownloadTrackUri(downloadedEpisode.track) ??
          downloadedEpisode.trackUri;
        console.log(
          "[episode-playback][local-source]",
          JSON.stringify({
            libraryItemId,
            episodeId,
            storedFilename: downloadedEpisode.track.filename,
            storedCleanFilename: downloadedEpisode.track.cleanFileName,
            storedRelativePath: downloadedEpisode.track.relativePath,
            mimeType: downloadedEpisode.mimeType ?? null,
            durationSeconds: downloadedEpisode.durationSeconds,
            ...describeLocalAudioSourceUri(trackUri),
          }),
        );
        queue = [
          {
            id: `${libraryItemId}-${episodeId}-download-0`,
            libraryItemId,
            sessionId: LOCAL_SESSION_ID,
            trackIndex: 0,
            title: episodeTitle,
            author: podcastTitle,
            artworkUri: downloadedEpisode.artworkUri ?? undefined,
            durationMs,
            startOffsetMs: 0,
            source: {
              uri: trackUri,
              mimeType: downloadedEpisode.mimeType ?? undefined,
              isLocal: true,
            },
          },
        ];
      } else if (streamedSession) {
        episodeTitle =
          options?.episodeTitle?.trim() ||
          streamedSession.displayTitle ||
          episodeTitle;
        podcastTitle =
          options?.podcastTitle?.trim() ||
          streamedSession.displayAuthor ||
          streamedSession.libraryItem.media.metadata.title ||
          podcastTitle;
        const builtQueue = buildPlaybackQueue(streamedSession);
        queue = builtQueue.queue;
        durationMs = builtQueue.durationMs;
        resolvedSessionId = streamedSession.id;
      }

      const localIntent = getEpisodeProgressSyncIntent(libraryItemId, episodeId);
      let serverCurrentTimeSeconds: number | null = null;
      let serverIsFinished = false;
      if (this.canUseServer()) {
        try {
          const serverProgress = await meApi.getEpisodeProgress(libraryItemId, episodeId);
          serverCurrentTimeSeconds = serverProgress.currentTime;
          serverIsFinished = serverProgress.isFinished;
        } catch {
          // Offline / missing progress — Resume Resolution falls back to local intent.
        }
      }

      const resumeSeconds = resolveEpisodeResumePositionSeconds({
        localIntent,
        serverCurrentTimeSeconds,
        serverIsFinished,
      });
      const resumePositionMs = secondsToMs(resumeSeconds);
      const storedBookRate = this.resolveStoredBookRate(
        this.buildCandidateIds(libraryItemId),
      );

      displayedListeningPositionStore.getState().actions.setResumeResolution({
        libraryItemId,
        positionMs: resumePositionMs,
        durationMs,
      });

      this.listenedMs = 0;
      this.lastSyncAttemptAt = 0;
      this.lastSyncAt = 0;
      this.lastTrackedPositionMs = 0;

      if (playbackSource === "stream" && options?.autoPlay) {
        await this.startProvisionalStreamedPlayback({
          libraryItemId,
          bookTitle: episodeTitle,
          secondaryTitle: podcastTitle,
          episodeId,
          sessionId: resolvedSessionId,
          queue,
          durationMs,
          chapterIndex,
          resumePositionMs,
          rate: storedBookRate,
        });
        return;
      }

      playbackStore.getState().actions.setSession({
        libraryItemId,
        bookTitle: episodeTitle,
        secondaryTitle: podcastTitle,
        episodeId,
        sessionId: resolvedSessionId,
        queue,
        durationMs,
        chapterIndex,
      });
      playbackStore.getState().actions.setRate(storedBookRate);

      const targetTrack = findTrackForPosition(queue, resumePositionMs) ?? queue[0];
      const targetIndex = queue.indexOf(targetTrack);
      const trackPositionMs = Math.max(0, resumePositionMs - targetTrack.startOffsetMs);
      await this.loadTrack(targetIndex, { initialPositionMs: trackPositionMs });

      if (options?.autoPlay) {
        await this.performPlay();
        if (attemptedDownloadedAudio) {
          const postPlayState = playbackStore.getState();
          if (postPlayState.playbackState !== "playing" && this.canUseServer()) {
            await this.loadEpisode(libraryItemId, episodeId, options, {
              preferDownloaded: false,
            });
            return;
          }
        }
      } else {
        playbackStore.getState().actions.setPlaybackState("ready");
      }
    } catch (error) {
      if (!tornDownExistingPlayback) {
        if (suppressErrorState) return;
        throw error;
      }
      if (suppressErrorState) {
        playbackStore.getState().actions.resetAfterFailedStart({
          libraryItemId,
          bookTitle: options?.episodeTitle ?? null,
          positionMs: 0,
          rate: 1,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      throw error;
    }
  }

  async requestPlay(): Promise<PlaybackControlResult> {
    const state = playbackStore.getState();
    const accepted = this.beginPlaybackControlIntent({
      kind: "play",
      libraryItemId: state.libraryItemId,
      requestedAudibleState: "playing",
    });
    if (accepted.status !== "accepted") return accepted;
    if (state.playbackState === "playing") {
      this.finishPlaybackControlIntent(accepted.intentId);
      return { status: "already_satisfied", state: "playing" };
    }

    try {
      if (!state.queue.length) {
        if (state.libraryItemId && state.episodeId) {
          await this.loadEpisode(state.libraryItemId, state.episodeId, { autoPlay: true });
        } else if (state.libraryItemId) {
          await this.loadBook(state.libraryItemId, { autoPlay: true });
        }
      } else {
        await this.performPlay();
      }
      return accepted;
    } finally {
      this.finishPlaybackControlIntent(accepted.intentId);
    }
  }

  async requestPause(): Promise<PlaybackControlResult> {
    const state = playbackStore.getState();
    const accepted = this.beginPlaybackControlIntent({
      kind: "pause",
      libraryItemId: state.libraryItemId,
      requestedAudibleState: "paused",
    });
    if (accepted.status !== "accepted") return accepted;
    if (state.playbackState === "paused") {
      this.finishPlaybackControlIntent(accepted.intentId);
      return { status: "already_satisfied", state: "paused" };
    }

    try {
      await this.performPause();
      return accepted;
    } finally {
      this.finishPlaybackControlIntent(accepted.intentId);
    }
  }

  async play(options?: {
    touchProgressCache?: boolean;
    updatePlaybackStore?: boolean;
    disableLocalStreamFallback?: boolean;
  }) {
    await this.performPlay(options);
  }

  async pause(options?: { syncProgress?: boolean; updatePlaybackStore?: boolean }) {
    await this.performPause(options);
  }

  async stop() {
    await this.closeActiveBookForTransition();
  }

  async prepareForDownloadedBookDeletion(
    libraryItemId: string,
  ): Promise<DownloadedBookDeletionPlaybackSnapshot | null> {
    await this.flushPendingSkipBurstBeforeExit();
    const state = playbackStore.getState();
    const isActiveLocalSession =
      state.libraryItemId === libraryItemId &&
      state.sessionId === LOCAL_SESSION_ID &&
      state.queue.some((track) => track.source.isLocal);

    if (!isActiveLocalSession) {
      return null;
    }

    const snapshot: DownloadedBookDeletionPlaybackSnapshot = {
      libraryItemId,
      wasActiveLocalSession: true,
      wasPlaying: state.playbackState === "playing",
      positionMs: state.positionMs,
    };

    if (state.playbackState === "playing") {
      this.recordListeningInterruptionForState(state);
      try {
        await this.engine.pause();
      } catch (error) {
        if (__DEV__) {
          console.warn("[player-service] download-delete:pause-before-delete-failed", {
            libraryItemId,
            error,
          });
        }
      }
      playbackStore.getState().actions.setPlaybackState("paused");
    }

    await this.syncProgress("download_deleted", {
      state: playbackStore.getState(),
      forceDirectProgressUpdate: true,
    });

    await this.unloadAndResetPlayback({ preservePlaybackControlIntent: true });
    return snapshot;
  }

  async resumeAfterDownloadedBookDeletion(
    snapshot: DownloadedBookDeletionPlaybackSnapshot | null,
  ) {
    if (!snapshot?.wasActiveLocalSession) return;

    try {
      await this.loadBook(
        snapshot.libraryItemId,
        { autoPlay: false },
        { preferDownloaded: false },
      );
      await this.seekToImmediate(snapshot.positionMs, {
        syncProgress: false,
        allowDuringPlaybackControlIntent: true,
      });
      if (snapshot.wasPlaying) {
        await this.performPlay({ applyAutoRewind: false });
      }
    } catch (error) {
      if (__DEV__) {
        console.warn("[player-service] download-delete:stream-reload-failed", {
          libraryItemId: snapshot.libraryItemId,
          error,
        });
      }
    }
  }

  async prepareForDownloadedEpisodeDeletion(
    libraryItemId: string,
    episodeId: string,
  ): Promise<DownloadedEpisodeDeletionPlaybackSnapshot | null> {
    await this.flushPendingSkipBurstBeforeExit();
    const state = playbackStore.getState();
    const isActiveLocalSession =
      state.libraryItemId === libraryItemId &&
      state.episodeId === episodeId &&
      state.sessionId === LOCAL_SESSION_ID &&
      state.queue.some((track) => track.source.isLocal);
    if (!isActiveLocalSession) return null;

    const snapshot: DownloadedEpisodeDeletionPlaybackSnapshot = {
      libraryItemId,
      episodeId,
      wasActiveLocalSession: true,
      wasPlaying: state.playbackState === "playing",
      positionMs: state.positionMs,
      episodeTitle: state.bookTitle,
      podcastTitle: state.secondaryTitle,
    };

    if (state.playbackState === "playing") {
      this.recordListeningInterruptionForState(state);
      try {
        await this.engine.pause();
      } catch (error) {
        if (__DEV__) {
          console.warn("[player-service] episode-download-delete:pause-before-delete-failed", {
            libraryItemId,
            episodeId,
            error,
          });
        }
      }
      playbackStore.getState().actions.setPlaybackState("paused");
    }

    await this.syncProgress("download_deleted", {
      state: playbackStore.getState(),
      forceDirectProgressUpdate: true,
    });
    await this.unloadAndResetPlayback({ preservePlaybackControlIntent: true });
    return snapshot;
  }

  async resumeAfterDownloadedEpisodeDeletion(
    snapshot: DownloadedEpisodeDeletionPlaybackSnapshot | null,
  ) {
    if (!snapshot?.wasActiveLocalSession) return;

    try {
      await this.loadEpisode(
        snapshot.libraryItemId,
        snapshot.episodeId,
        {
          autoPlay: false,
          episodeTitle: snapshot.episodeTitle,
          podcastTitle: snapshot.podcastTitle,
        },
        { preferDownloaded: false },
      );
      await this.seekToImmediate(snapshot.positionMs, {
        syncProgress: false,
        allowDuringPlaybackControlIntent: true,
      });
      if (snapshot.wasPlaying) {
        await this.performPlay({ applyAutoRewind: false });
      }
    } catch (error) {
      if (__DEV__) {
        console.warn("[player-service] episode-download-delete:stream-reload-failed", {
          libraryItemId: snapshot.libraryItemId,
          episodeId: snapshot.episodeId,
          error,
        });
      }
    }
  }

  async finishActiveBook(payload: { libraryItemId: string; durationSeconds?: number }) {
    this.cancelPendingSkipBurst();
    const state = playbackStore.getState();
    if (state.libraryItemId !== payload.libraryItemId || !state.queue.length) {
      throw new Error("Active playback session not found");
    }

    const finalDurationMs = Math.max(
      state.durationMs,
      secondsToMs(payload.durationSeconds ?? 0),
      resolveQueueDurationMs(state.queue),
    );
    const finalPositionMs = Math.max(0, finalDurationMs);
    const finalTrack = findTrackForPosition(state.queue, finalPositionMs);
    if (!finalTrack) {
      throw new Error("Unable to resolve final playback position");
    }

    const finalTrackIndex = state.queue.indexOf(finalTrack);
    const finalTrackPositionMs = Math.max(
      0,
      Math.min(finalPositionMs - finalTrack.startOffsetMs, finalTrack.durationMs),
    );
    const finalChapter = findChapterForPosition(state.chapterIndex, finalPositionMs);
    const finalCurrentTimeSeconds = msToSeconds(finalPositionMs);
    const authState = authStore.getState();
    const activeLibraryId = authState.activeLibraryId;

    try {
      await this.engine.pause();
    } catch {
      // Ignore pause failures; the session is being ended explicitly below.
    }

    const syncResult = await syncListeningPosition({
      state,
      reason: "finish",
      currentTimeSeconds: finalCurrentTimeSeconds,
      durationSeconds: finalCurrentTimeSeconds,
      timeListenedSeconds: msToSeconds(this.listenedMs),
      isFinished: true,
      title: state.bookTitle,
      sessionKind: this.resolveSessionKind(state.sessionId),
      closeStreamSession: true,
      forceDirectProgressUpdate: true,
      intentKind: "mark_finished",
      updateLocalProgress: (progress) => {
        // Episode Listening Position is durable on Touched Episode rows — never book maps.
        if (state.episodeId) return;
        this.updateUserServerStateCache(progress);
      },
      setLastSyncAt: (timestamp) => {
        this.lastSyncAt = timestamp;
        playbackStore.getState().actions.setLastSyncAt(timestamp);
      },
    });

    if (activeLibraryId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booksInProgress(activeLibraryId),
      });
    }

    this.lastSyncAt = syncResult?.syncedToServer ? this.lastSyncAt : 0;

    try {
      await this.engine.unload();
    } finally {
      playbackStore.getState().actions.endSession({
        libraryItemId: payload.libraryItemId,
        bookTitle: state.bookTitle,
        positionMs: finalPositionMs,
        trackPositionMs: finalTrackPositionMs,
        durationMs: finalDurationMs,
        trackDurationMs: finalTrack.durationMs,
        currentTrackIndex: finalTrackIndex >= 0 ? finalTrackIndex : state.currentTrackIndex,
        currentChapterId: finalChapter?.id ?? null,
      });
      playbackStore.getState().actions.setLastSyncAt(
        syncResult?.syncedToServer ? this.lastSyncAt : null,
      );
      this.listenedMs = 0;
      this.lastSyncAttemptAt = 0;
      this.lastTrackedPositionMs = finalPositionMs;
    }
  }

  private async seekToImmediate(
    positionMs: number,
    options?: {
      confirmDisplayedPosition?: boolean;
      syncProgress?: boolean;
      rollbackOptimisticPositionMs?: number;
      allowDuringPlaybackControlIntent?: boolean;
      progressSyncReason?: Extract<ProgressSyncReason, "seek" | "auto_rewind">;
    },
  ) {
    if (
      !options?.allowDuringPlaybackControlIntent &&
      this.hasBlockingPlaybackControlIntent()
    ) {
      return;
    }
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
    const isFinished = state.durationMs > 0 && boundedPosition >= state.durationMs - secondsToMs(3);
    if (isPlaying) {
      this.nativeSeekPauseGuardUntilMs = Date.now() + NATIVE_SEEK_PAUSE_GUARD_MS;
    }

    displayedListeningPositionStore.getState().actions.startUserPositionChange({
      libraryItemId: state.libraryItemId as string,
      positionMs: boundedPosition,
      durationMs: state.durationMs,
      isFinished,
    });

    try {
      if (targetIndex !== state.currentTrackIndex) {
        await this.loadTrack(targetIndex, {
          initialPositionMs: trackPositionMs,
          autoPlay: isPlaying,
        });
      } else {
        await this.engine.seek(trackPositionMs);
      }
    } catch (error) {
      displayedListeningPositionStore
        .getState()
        .actions.rollbackUserPositionChange(state.libraryItemId as string, {
          optimisticPositionMs: options?.rollbackOptimisticPositionMs,
        });
      throw error;
    }

    playbackStore.getState().actions.setPosition({
      positionMs: boundedPosition,
      trackPositionMs,
    });
    if (options?.confirmDisplayedPosition !== false) {
      displayedListeningPositionStore.getState().actions.confirmUserPositionChange(
        {
          libraryItemId: state.libraryItemId as string,
          positionMs: boundedPosition,
          durationMs: state.durationMs,
          isFinished,
        },
        {
          optimisticPositionMs: options?.rollbackOptimisticPositionMs,
        },
      );
    }
    const chapterAtPosition = findChapterForPosition(state.chapterIndex, boundedPosition);
    playbackStore.getState().actions.setCurrentChapter(chapterAtPosition?.id ?? null);
    this.lastTrackedPositionMs = boundedPosition;
    if (options?.syncProgress !== false) {
      await this.syncProgress(options?.progressSyncReason ?? "seek");
    }
  }

  async seekTo(positionMs: number, options?: { syncProgress?: boolean }) {
    this.cancelPendingSkipBurst();
    if (this.skipSeekInFlight) {
      await this.skipSeekInFlight.catch(() => undefined);
    }
    const state = playbackStore.getState();
    if (state.libraryItemId) {
      deviceBooksStore.getState().actions.clearListeningInterruption(state.libraryItemId, {
        userKey: this.resolveUserKeyForLibraryItem(state.libraryItemId),
      });
    }
    await this.seekToImmediate(positionMs, options);
  }

  async skipBy(seconds: number, goBackwards: boolean = false) {
    const state = playbackStore.getState();
    if (this.hasBlockingPlaybackControlIntent()) return;
    if (!state.queue.length || !state.libraryItemId) return;
    deviceBooksStore.getState().actions.clearListeningInterruption(state.libraryItemId, {
      userKey: this.resolveUserKeyForLibraryItem(state.libraryItemId),
    });
    let skipMs = secondsToMs(seconds);
    if (goBackwards) {
      skipMs = -skipMs;
    }
    const now = Date.now();
    const basePositionMs = this.getSkipBasePositionMs(state);
    const maxPosition = state.durationMs > 0 ? state.durationMs : basePositionMs + skipMs;
    const targetPositionMs = Math.max(0, Math.min(basePositionMs + skipMs, maxPosition));
    const isFinished =
      state.durationMs > 0 && targetPositionMs >= state.durationMs - secondsToMs(3);

    const existingBurst =
      this.pendingSkipBurst?.libraryItemId === state.libraryItemId ? this.pendingSkipBurst : null;
    if (this.pendingSkipBurst && !existingBurst) {
      this.cancelPendingSkipBurst();
    }

    this.pendingSkipBurst = {
      libraryItemId: state.libraryItemId,
      targetPositionMs,
      startedAt: existingBurst?.startedAt ?? now,
      lastUpdatedAt: now,
    };

    displayedListeningPositionStore.getState().actions.startUserPositionChange({
      libraryItemId: state.libraryItemId,
      positionMs: targetPositionMs,
      durationMs: state.durationMs,
      isFinished,
    });

    this.scheduleSkipBurstFlush();
  }

  async playClipPreview(payload: {
    libraryItemId: string;
    episodeId?: string | null;
    bookmarkId?: string | null;
    startTimeSeconds: number;
    endTimeSeconds: number;
  }) {
    const startMs = secondsToMs(payload.startTimeSeconds);
    const endMs = secondsToMs(payload.endTimeSeconds);
    if (endMs <= startMs) {
      throw new Error("Clip end must be after clip start");
    }

    const stateBeforePreview = playbackStore.getState();
    const availability = resolveClipPreviewAvailability({
      targetLibraryItemId: payload.libraryItemId,
      targetEpisodeId: payload.episodeId ?? null,
      activeLibraryItemId: stateBeforePreview.libraryItemId,
      activeEpisodeId: stateBeforePreview.episodeId,
      activeQueueLength: stateBeforePreview.queue.length,
    });
    if (!availability.available) {
      throw new Error(availability.reason ?? "Unable to preview clip");
    }

    const restoreState: ClipPreviewRestoreState = {
      libraryItemId: stateBeforePreview.libraryItemId,
      episodeId: stateBeforePreview.episodeId,
      positionMs: stateBeforePreview.positionMs,
      playbackState: stateBeforePreview.playbackState,
      queueWasLoaded: stateBeforePreview.queue.length > 0,
    };
    if (stateBeforePreview.playbackState === "playing") {
      playbackStore.getState().actions.setPlaybackState("paused");
    }
    const startTrack = findTrackForPosition(stateBeforePreview.queue, startMs);
    if (!startTrack) {
      throw new Error("Unable to resolve clip start position");
    }
    this.clipPreviewSession = {
      libraryItemId: payload.libraryItemId,
      episodeId: payload.episodeId ?? null,
      bookmarkId: payload.bookmarkId ?? null,
      startMs,
      endMs,
      restoreState,
      currentTrackIndex: stateBeforePreview.currentTrackIndex,
      stoppedAtEnd: false,
    };
    clipPreviewStore.getState().actions.startLoading({
      libraryItemId: payload.libraryItemId,
      episodeId: payload.episodeId ?? null,
      bookmarkId: payload.bookmarkId ?? null,
      startMs,
      endMs,
    });

    try {
      await this.seekPreviewEngineTo(startMs);
      await this.performPlay({
        touchProgressCache: false,
        updatePlaybackStore: false,
        disableLocalStreamFallback: true,
      });
      clipPreviewStore.getState().actions.setPlaying();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to preview clip";
      clipPreviewStore.getState().actions.setError(message);
      throw error;
    }
  }

  private async seekPreviewEngineTo(positionMs: number) {
    const previewSession = this.clipPreviewSession;
    if (!previewSession) return;

    const state = playbackStore.getState();
    if (
      state.libraryItemId !== previewSession.libraryItemId ||
      (state.episodeId ?? null) !== previewSession.episodeId ||
      !state.queue.length
    ) {
      throw new Error("Clip preview requires the media item to be loaded");
    }

    const maxPosition = state.durationMs > 0 ? state.durationMs : positionMs;
    const boundedPosition = Math.max(0, Math.min(positionMs, maxPosition));
    const targetTrack = findTrackForPosition(state.queue, boundedPosition);
    if (!targetTrack) {
      throw new Error("Unable to resolve clip preview position");
    }

    const targetIndex = state.queue.indexOf(targetTrack);
    const trackPositionMs = Math.max(0, boundedPosition - targetTrack.startOffsetMs);
    if (targetIndex !== previewSession.currentTrackIndex) {
      this.clipPreviewSession = {
        ...previewSession,
        currentTrackIndex: targetIndex,
      };
      await this.engine.load(targetTrack, {
        initialPositionMs: trackPositionMs,
        rate: state.rate,
        pitchCorrectionQuality: settingsStore.getState().pitchCorrectionQuality,
      });
    } else {
      await this.engine.seek(trackPositionMs);
    }

    clipPreviewStore.getState().actions.setPosition(boundedPosition);
  }

  private async restoreEngineToListeningPosition(
    restoreState: ClipPreviewRestoreState,
    options?: { currentEngineTrackIndex?: number },
  ) {
    if (!restoreState.libraryItemId || !restoreState.queueWasLoaded) {
      await this.engine.pause();
      return;
    }

    const state = playbackStore.getState();
    if (
      state.libraryItemId !== restoreState.libraryItemId ||
      (state.episodeId ?? null) !== restoreState.episodeId ||
      !state.queue.length
    ) {
      await this.engine.pause();
      return;
    }

    const maxPosition = state.durationMs > 0 ? state.durationMs : restoreState.positionMs;
    const boundedPosition = Math.max(0, Math.min(restoreState.positionMs, maxPosition));
    const targetTrack = findTrackForPosition(state.queue, boundedPosition);
    if (!targetTrack) {
      await this.engine.pause();
      return;
    }

    const targetIndex = state.queue.indexOf(targetTrack);
    const trackPositionMs = Math.max(0, boundedPosition - targetTrack.startOffsetMs);
    const currentEngineTrackIndex = options?.currentEngineTrackIndex ?? state.currentTrackIndex;
    await this.engine.pause();
    if (targetIndex !== currentEngineTrackIndex) {
      await this.engine.load(targetTrack, {
        initialPositionMs: trackPositionMs,
        rate: state.rate,
        pitchCorrectionQuality: settingsStore.getState().pitchCorrectionQuality,
      });
    } else {
      await this.engine.seek(trackPositionMs);
    }
  }

  private resolvePostPreviewPlaybackState(restoreState: ClipPreviewRestoreState) {
    return restoreState.playbackState === "playing" ? "paused" : restoreState.playbackState;
  }

  private restorePlaybackStoreToListeningPosition(restoreState: ClipPreviewRestoreState) {
    if (!restoreState.libraryItemId || !restoreState.queueWasLoaded) {
      return null;
    }

    const state = playbackStore.getState();
    if (
      state.libraryItemId !== restoreState.libraryItemId ||
      (state.episodeId ?? null) !== restoreState.episodeId ||
      !state.queue.length
    ) {
      return null;
    }

    const maxPosition = state.durationMs > 0 ? state.durationMs : restoreState.positionMs;
    const boundedPosition = Math.max(0, Math.min(restoreState.positionMs, maxPosition));
    const targetTrack = findTrackForPosition(state.queue, boundedPosition);
    if (!targetTrack) {
      return null;
    }

    const targetIndex = state.queue.indexOf(targetTrack);
    const trackPositionMs = Math.max(0, boundedPosition - targetTrack.startOffsetMs);
    if (targetIndex !== state.currentTrackIndex) {
      playbackStore.getState().actions.setCurrentTrack(targetIndex, targetTrack.durationMs);
    }
    playbackStore.getState().actions.setPosition({
      positionMs: boundedPosition,
      trackPositionMs,
    });
    const chapterAtPosition = findChapterForPosition(state.chapterIndex, boundedPosition);
    playbackStore.getState().actions.setCurrentChapter(chapterAtPosition?.id ?? null);
    playbackStore
      .getState()
      .actions.setPlaybackState(this.resolvePostPreviewPlaybackState(restoreState));
    this.lastTrackedPositionMs = boundedPosition;
    return boundedPosition;
  }

  async restoreListeningPositionAfterPreview() {
    const previewSession = this.clipPreviewSession;
    if (!previewSession) return;

    try {
      await this.restoreEngineToListeningPosition(previewSession.restoreState, {
        currentEngineTrackIndex: previewSession.currentTrackIndex,
      });
    } finally {
      const restoredPositionMs = this.restorePlaybackStoreToListeningPosition(
        previewSession.restoreState,
      );
      if (restoredPositionMs !== null) {
        this.postPreviewStatusGuard = {
          untilMs: Date.now() + POST_PREVIEW_STATUS_GUARD_MS,
          restoredPositionMs,
        };
      }
      this.clipPreviewSession = null;
      clipPreviewStore.getState().actions.reset();
    }
  }

  async cancelPreviewForExplicitNavigation() {
    const previewSession = this.clipPreviewSession;
    if (!previewSession) return;

    try {
      await this.engine.pause();
    } catch {
      // Ignore cancellation pause failures; explicit navigation is about to take over.
    } finally {
      this.clipPreviewSession = null;
      clipPreviewStore.getState().actions.reset();
    }
  }

  async setRate(rate: number) {
    const normalizedRate = clampPlaybackRate(rate);
    this.logDebug(`setRate: ${normalizedRate}`);
    const state = playbackStore.getState();
    const previousPlaybackState = state.playbackState;
    playbackStore.getState().actions.setRate(normalizedRate);
    if (state.libraryItemId) {
      deviceBooksStore.getState().actions.setBookPlaybackRate(state.libraryItemId, normalizedRate, {
        userKey: this.resolveUserKeyForLibraryItem(state.libraryItemId),
      });
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

  async reconcilePlaybackRateRange() {
    const state = playbackStore.getState();
    const normalizedRate = clampPlaybackRate(state.rate ?? DEFAULT_BOOK_PLAYBACK_RATE);
    if (Math.abs(normalizedRate - state.rate) < 0.0001) {
      return;
    }
    await this.setRate(normalizedRate);
  }

  async setPitchCorrectionQuality(quality: PitchCorrectionQuality) {
    this.logDebug(`setPitchCorrectionQuality: ${quality}`);
    settingsStore.getState().actions.setPitchCorrectionQuality(quality);
    await this.engine.setRate(playbackStore.getState().rate, quality);
  }

  async nextTrack() {
    this.cancelPendingSkipBurst();
    const state = playbackStore.getState();
    const nextIndex = state.currentTrackIndex + 1;
    if (nextIndex >= state.queue.length) {
      if (state.libraryItemId) {
        await this.finishActiveBook({
          libraryItemId: state.libraryItemId,
          durationSeconds: msToSeconds(state.durationMs),
        });
      } else {
        playbackStore.getState().actions.setPlaybackState("ended");
      }
      return;
    }

    const shouldAutoPlay = state.playbackState === "playing";
    await this.loadTrack(nextIndex, { initialPositionMs: 0, autoPlay: shouldAutoPlay });
  }

  async previousTrack() {
    this.cancelPendingSkipBurst();
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
    if (this.hasBlockingPlaybackControlIntent()) return;
    const chapter = state.chapterIndex.find((item) => item.id === chapterId);
    if (!chapter) return;
    await this.seekTo(chapter.startMs);
  }

  async nextChapter() {
    const state = playbackStore.getState();
    if (this.hasBlockingPlaybackControlIntent()) return;
    if (!state.queue.length) return;

    if (!state.chapterIndex.length) return;

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
    if (this.hasBlockingPlaybackControlIntent()) return;
    if (!state.queue.length) return;

    if (!state.chapterIndex.length) return;

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
    this.playbackTrace(
      `loadTrack:engine-load index=${index} local=${String(track.source.isLocal ?? false)}`,
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
    if (state.libraryItemId) {
      displayedListeningPositionStore.getState().actions.markPlaybackProgress({
        libraryItemId: state.libraryItemId,
        positionMs: bookPositionMs,
        durationMs: state.durationMs,
        isFinished: state.durationMs > 0 && bookPositionMs >= state.durationMs - secondsToMs(3),
      });
    }
    const chapterAtPosition = findChapterForPosition(state.chapterIndex, bookPositionMs);
    playbackStore.getState().actions.setCurrentChapter(chapterAtPosition?.id ?? null);

    this.lastTrackedPositionMs = bookPositionMs;

    if (options?.autoPlay) {
      await this.performPlay({ applyAutoRewind: false });
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
    const handledAsClipPreview = await this.handleClipPreviewStatus(status, state);
    if (handledAsClipPreview) return;

    const currentTrack = state.queue[state.currentTrackIndex];
    if (!currentTrack) return;

    const trackPositionMs = Math.max(0, status.positionMs);
    const positionMs = currentTrack.startOffsetMs + trackPositionMs;
    const displayedPositionRecord = state.libraryItemId
      ? displayedListeningPositionStore.getState().byLibraryItemId[state.libraryItemId]
      : undefined;
    const resumeFloorMs = displayedPositionRecord?.chosenResumePositionMs;
    if (resumeFloorMs !== null && resumeFloorMs !== undefined && positionMs < resumeFloorMs) {
      return;
    }
    if (await this.shouldIgnorePostPreviewStatus(status, positionMs)) {
      return;
    }
    const updates: Parameters<PlaybackStoreState["actions"]["applyStatusUpdate"]>[0] = {
      positionMs,
      trackPositionMs,
    };
    const previousPlaybackState = state.playbackState;
    let didTransitionToNonPlaying = false;
    const isNativeSeekPauseGuardActive = Date.now() < this.nativeSeekPauseGuardUntilMs;

    // Keep store playbackState aligned with engine state.
    if (status.isPlaying && state.playbackState !== "playing") {
      this.nativeSeekPauseGuardUntilMs = 0;
      updates.playbackState = "playing";
      // Playback can resume from system controls/background without going through play().
      // Reconcile and reapply persisted speed on this transition.
      void this.reconcilePlaybackRate("status-transition");
    } else if (
      !status.isPlaying &&
      state.playbackState === "playing" &&
      !isNativeSeekPauseGuardActive
    ) {
      updates.playbackState = "paused";
      didTransitionToNonPlaying = true;
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
    if (state.libraryItemId) {
      displayedListeningPositionStore.getState().actions.markPlaybackProgress({
        libraryItemId: state.libraryItemId,
        positionMs,
        durationMs: state.durationMs,
        isFinished: state.durationMs > 0 && positionMs >= state.durationMs - secondsToMs(3),
      });
    }

    // Accumulate listening time for sync (ignore large jumps).
    if (status.isPlaying || didTransitionToNonPlaying) {
      const delta = positionMs - this.lastTrackedPositionMs;
      if (delta > 0 && delta <= MAX_LISTEN_DELTA_MS) {
        this.listenedMs += delta;
      }
    }

    this.lastTrackedPositionMs = positionMs;

    let externalPauseSyncResult: { syncAttempted: boolean; dedupeSkipped: boolean } | null = null;
    if (didTransitionToNonPlaying && !status.didJustFinish) {
      this.recordListeningInterruptionForState(state);
      externalPauseSyncResult = await this.syncPauseLikeProgress("external_pause", {
        state: playbackStore.getState(),
      });
    }

    if (updates.playbackState) {
      progressLogStore.getState().actions.appendEntry({
        eventType: "playback_state_transition",
        trigger: didTransitionToNonPlaying ? "native_non_playing_status" : "native_playing_status",
        libraryItemId: state.libraryItemId,
        title: this.resolveBookTitle(state),
        sessionKind: this.resolveSessionKind(state.sessionId),
        fromPlaybackState: previousPlaybackState,
        toPlaybackState: updates.playbackState,
        engineIsPlaying: status.isPlaying,
        positionSeconds: msToSeconds(positionMs),
        trackPositionSeconds: msToSeconds(trackPositionMs),
        durationSeconds: msToSeconds(state.durationMs),
        syncAttempted: Boolean(externalPauseSyncResult?.syncAttempted),
        syncReason: externalPauseSyncResult ? "external_pause" : undefined,
        dedupeSkipped: Boolean(externalPauseSyncResult?.dedupeSkipped),
        note: didTransitionToNonPlaying
          ? externalPauseSyncResult?.dedupeSkipped
            ? "External pause sync skipped because an equivalent pause sync just ran"
            : "Native engine reported playback stopped without a manual pause path"
          : "Native engine reported playback resumed outside the direct play() path",
      });
    }

    if (status.isPlaying && previousPlaybackState !== "playing") {
      await this.applyAutoRewindBeforePlay(playbackStore.getState());
    }

    if (status.didJustFinish) {
      await this.handleTrackEnded();
      return;
    }

    // Sync to Audiobookshelf/local storage on interval.
    if (status.isPlaying && Date.now() - this.lastSyncAttemptAt >= SYNC_INTERVAL_MS) {
      await this.syncProgress("interval");
    }
  }

  private async shouldIgnorePostPreviewStatus(
    status: {
      isPlaying: boolean;
    },
    positionMs: number,
  ) {
    const guard = this.postPreviewStatusGuard;
    if (!guard) {
      return false;
    }

    if (Date.now() > guard.untilMs) {
      this.postPreviewStatusGuard = null;
      return false;
    }

    const isRestoredPosition =
      Math.abs(positionMs - guard.restoredPositionMs) <= POST_PREVIEW_RESTORED_POSITION_TOLERANCE_MS;
    if (status.isPlaying) {
      try {
        await this.engine.pause();
      } catch {
        // Ignore pause failures here; the store must still remain in the restored paused state.
      }
      playbackStore.getState().actions.setPlaybackState("paused");
      return true;
    }

    if (isRestoredPosition) {
      this.postPreviewStatusGuard = null;
      return false;
    }

    return true;
  }

  private async handleClipPreviewStatus(
    status: {
      positionMs: number;
      durationMs: number;
      isPlaying: boolean;
      didJustFinish: boolean;
    },
    state: PlaybackStoreState,
  ) {
    const previewSession = this.clipPreviewSession;
    if (!previewSession) return false;
    if (
      state.libraryItemId !== previewSession.libraryItemId ||
      (state.episodeId ?? null) !== previewSession.episodeId ||
      !state.queue.length
    ) {
      return true;
    }

    if (previewSession.stoppedAtEnd) {
      return true;
    }

    const currentPreviewTrack = state.queue[previewSession.currentTrackIndex];
    if (!currentPreviewTrack) {
      return true;
    }

    const trackPositionMs = Math.max(0, status.positionMs);
    const positionMs = currentPreviewTrack.startOffsetMs + trackPositionMs;
    const boundedPositionMs = Math.min(positionMs, previewSession.endMs);
    clipPreviewStore.getState().actions.setPosition(boundedPositionMs);

    if (boundedPositionMs >= previewSession.endMs) {
      const endedSession = {
        ...previewSession,
        stoppedAtEnd: true,
      };
      this.clipPreviewSession = endedSession;
      clipPreviewStore.getState().actions.setEnded();
      try {
        await this.restoreEngineToListeningPosition(endedSession.restoreState, {
          currentEngineTrackIndex: endedSession.currentTrackIndex,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to restore playback";
        clipPreviewStore.getState().actions.setError(message);
      }
      return true;
    }

    if (status.didJustFinish) {
      const nextTrackIndex = previewSession.currentTrackIndex + 1;
      const nextTrack = state.queue[nextTrackIndex];
      if (!nextTrack || nextTrack.startOffsetMs >= previewSession.endMs) {
        const endedSession = {
          ...previewSession,
          stoppedAtEnd: true,
        };
        this.clipPreviewSession = endedSession;
        clipPreviewStore.getState().actions.setEnded();
        await this.restoreEngineToListeningPosition(endedSession.restoreState, {
          currentEngineTrackIndex: endedSession.currentTrackIndex,
        });
        return true;
      }

      this.clipPreviewSession = {
        ...previewSession,
        currentTrackIndex: nextTrackIndex,
      };
      await this.engine.load(nextTrack, {
        initialPositionMs: 0,
        rate: state.rate,
        pitchCorrectionQuality: settingsStore.getState().pitchCorrectionQuality,
      });
      clipPreviewStore.getState().actions.setPosition(nextTrack.startOffsetMs);
      await this.engine.play();
      clipPreviewStore.getState().actions.setPlaying();
      return true;
    }

    if (status.isPlaying) {
      clipPreviewStore.getState().actions.setPlaying();
    } else {
      clipPreviewStore.getState().actions.setPaused();
    }

    return true;
  }

  private async handleTrackEnded() {
    if (this.clipPreviewSession) {
      return;
    }
    const state = playbackStore.getState();
    if (!state.queue.length) return;

    const nextIndex = state.currentTrackIndex + 1;
    if (nextIndex >= state.queue.length) {
      playbackStore.getState().actions.setPlaybackState("ended");
      return;
    }

    await this.loadTrack(nextIndex, { initialPositionMs: 0, autoPlay: true });
  }

  private resolveProgressForSync(payload: {
    libraryItemId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    timeListenedSeconds: number;
    isFinished: boolean;
    reason: ProgressSyncReason;
  }) {
    const cachedProgress = this.getCachedProgressForLibraryItem(payload.libraryItemId);
    const previousCurrentTimeSeconds = Math.max(0, Math.floor(cachedProgress?.currentTime ?? 0));
    const shouldPreventTransientRegression =
      payload.reason !== "seek" &&
      payload.reason !== "auto_rewind" &&
      !payload.isFinished &&
      Boolean(cachedProgress) &&
      !cachedProgress?.isFinished &&
      previousCurrentTimeSeconds >
        payload.currentTimeSeconds + PLAY_START_PROGRESS_FLOOR_TOLERANCE_SECONDS;

    return {
      currentTimeSeconds: shouldPreventTransientRegression
        ? previousCurrentTimeSeconds
        : payload.currentTimeSeconds,
      durationSeconds: Math.max(
        payload.durationSeconds,
        Math.max(0, Math.floor(cachedProgress?.duration ?? 0)),
      ),
      isFinished: shouldPreventTransientRegression
        ? Boolean(cachedProgress?.isFinished)
        : payload.isFinished,
      preventedRegression: shouldPreventTransientRegression,
    };
  }

  private async syncProgress(
    reason: ProgressSyncReason,
    options?: {
      state?: PlaybackStoreState;
      closeStreamSession?: boolean;
      forceDirectProgressUpdate?: boolean;
    },
  ) {
    const state = options?.state ?? playbackStore.getState();
    if (!state.libraryItemId || !state.sessionId) return;
    this.logDebug(`syncProgress: ${reason}`);
    this.lastSyncAttemptAt = Date.now();

    // Convert values to seconds to match Audiobookshelf API expectations.
    const currentTimeSeconds = msToSeconds(state.positionMs);
    const durationSeconds = msToSeconds(state.durationMs);
    const timeListenedSeconds = msToSeconds(this.listenedMs);
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);
    const promotedProgress = this.resolveProgressForSync({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds,
      durationSeconds,
      timeListenedSeconds,
      isFinished,
      reason,
    });
    recordCarPlayResumeSnapshot({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds: promotedProgress.currentTimeSeconds,
      durationSeconds: promotedProgress.durationSeconds,
      isFinished: promotedProgress.isFinished,
      updatedAt: Date.now(),
    });

    if (promotedProgress.preventedRegression && __DEV__) {
      console.warn("[player-service] progress:prevented-transient-regression", {
        reason,
        libraryItemId: state.libraryItemId,
        currentTimeSeconds,
        promotedCurrentTimeSeconds: promotedProgress.currentTimeSeconds,
        timeListenedSeconds,
      });
    }

    const syncResult = await syncListeningPosition({
      state,
      reason,
      currentTimeSeconds: promotedProgress.currentTimeSeconds,
      durationSeconds: promotedProgress.durationSeconds,
      timeListenedSeconds,
      isFinished: promotedProgress.isFinished,
      title: this.resolveBookTitle(state),
      sessionKind: this.resolveSessionKind(state.sessionId),
      closeStreamSession: options?.closeStreamSession,
      forceDirectProgressUpdate: options?.forceDirectProgressUpdate,
      updateLocalProgress: (progress) => {
        // Episode Listening Position is durable on Touched Episode rows — never book maps.
        if (state.episodeId) return;
        this.updateUserServerStateCache(progress);
      },
      setLastSyncAt: (timestamp) => {
        this.lastSyncAt = timestamp;
        playbackStore.getState().actions.setLastSyncAt(timestamp);
      },
    });
    if (!syncResult) return;

    progressLogStore.getState().actions.appendEntry({
      eventType: "progress_sync_point",
      trigger: reason,
      libraryItemId: state.libraryItemId,
      title: this.resolveBookTitle(state),
      sessionKind: this.resolveSessionKind(state.sessionId),
      syncPath:
        syncResult.syncedToServer || (syncResult.online && syncResult.authenticated)
          ? syncResult.syncPath
          : "queue_only",
      outcome: syncResult.syncOutcome,
      currentTimeSeconds: promotedProgress.currentTimeSeconds,
      durationSeconds: promotedProgress.durationSeconds,
      timeListenedSeconds,
      isFinished: promotedProgress.isFinished,
      online: syncResult.online,
      authenticated: syncResult.authenticated,
      hadQueuedProgress: syncResult.hadQueuedProgress,
      forcedDirectProgressUpdate: Boolean(options?.forceDirectProgressUpdate),
      closedStreamSession: Boolean(
        options?.closeStreamSession && state.sessionId !== LOCAL_SESSION_ID,
      ),
      preventedRegression: promotedProgress.preventedRegression,
      errorMessage: syncResult.syncErrorMessage,
    });
  }

  private touchUserServerStateCacheForPlayStart() {
    const state = playbackStore.getState();
    if (!state.libraryItemId) return;

    const cachedProgress = this.getCachedProgressForLibraryItem(state.libraryItemId);
    const currentTimeSeconds = msToSeconds(state.positionMs);
    const durationSeconds = msToSeconds(state.durationMs);
    const isFinished =
      state.durationMs > 0 && state.positionMs >= state.durationMs - secondsToMs(3);
    const previousCurrentTimeSeconds = Math.max(0, Math.floor(cachedProgress?.currentTime ?? 0));
    const shouldPreventTransientRegression =
      Boolean(cachedProgress) &&
      !cachedProgress?.isFinished &&
      previousCurrentTimeSeconds >
        currentTimeSeconds + PLAY_START_PROGRESS_FLOOR_TOLERANCE_SECONDS;
    const promotedCurrentTimeSeconds = shouldPreventTransientRegression
      ? previousCurrentTimeSeconds
      : currentTimeSeconds;
    const promotedDurationSeconds = Math.max(
      durationSeconds,
      Math.max(0, Math.floor(cachedProgress?.duration ?? 0)),
    );
    const promotedIsFinished = shouldPreventTransientRegression
      ? Boolean(cachedProgress?.isFinished)
      : isFinished;

    // Promote the currently playing title in local cache immediately; server sync still
    // happens on interval/pause/seek.
    this.updateUserServerStateCache({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds: promotedCurrentTimeSeconds,
      durationSeconds: promotedDurationSeconds,
      isFinished: promotedIsFinished,
    });
  }

  private getCachedProgressForLibraryItem(libraryItemId: string) {
    const activeLibraryUserKey = authStore.getState().activeLibraryUserKey;
    if (!activeLibraryUserKey) return null;

    const cachedUserServerState = queryClient.getQueryData<UserServerState>(
      queryKeys.userServerState(activeLibraryUserKey),
    );
    const progressByLibraryItemId =
      cachedUserServerState?.progressByLibraryItemId ??
      // Compatibility for older persisted query shape.
      (
        cachedUserServerState as UserServerState & {
          progressByBookId?: UserServerState["progressByLibraryItemId"];
        }
      )?.progressByBookId ??
      {};

    const directMatch = progressByLibraryItemId[libraryItemId];
    if (directMatch) return directMatch;

    return pickNewestProgress(
      Object.values(progressByLibraryItemId).filter(
        (progress) => progress?.libraryItemId === libraryItemId,
      ),
    );
  }

  private updateUserServerStateCache(payload: {
    libraryItemId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    isFinished: boolean;
  }) {
    recordCarPlayResumeSnapshot({
      libraryItemId: payload.libraryItemId,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
      updatedAt: Date.now(),
    });

    const activeLibraryUserKey = authStore.getState().activeLibraryUserKey;
    if (!activeLibraryUserKey) {
      return;
    }

    const previousState = queryClient.getQueryData<UserServerState>(
      queryKeys.userServerState(activeLibraryUserKey),
    );
    const previousProgress = previousState?.progressByLibraryItemId[payload.libraryItemId];
    const now = Date.now();
    const resolvedDuration =
      payload.durationSeconds > 0 ? payload.durationSeconds : (previousProgress?.duration ?? 0);
    const progressPercent =
      resolvedDuration > 0
        ? Math.max(0, Math.min(1, payload.currentTimeSeconds / resolvedDuration))
        : (previousProgress?.progressPercent ?? 0);

    const nextProgress: UserBookProgress = {
      progressId: previousProgress?.progressId ?? `${payload.libraryItemId}:local`,
      libraryItemId: payload.libraryItemId,
      mediaItemId: previousProgress?.mediaItemId,
      duration: resolvedDuration,
      progressPercent,
      currentTime: payload.currentTimeSeconds,
      isFinished: payload.isFinished,
      hideFromContinueListening: previousProgress?.hideFromContinueListening ?? false,
      startedAt: previousProgress?.startedAt ?? now,
      finishedAt: payload.isFinished ? (previousProgress?.finishedAt ?? now) : null,
      lastUpdate: now,
    };

    queryClient.setQueryData<UserServerState>(
      queryKeys.userServerState(activeLibraryUserKey),
      (oldState) => {
        const nextState = oldState ?? createEmptyUserServerState(activeLibraryUserKey);
        return {
          ...nextState,
          progressByLibraryItemId: {
            ...nextState.progressByLibraryItemId,
            [payload.libraryItemId]: nextProgress,
          },
        };
      },
    );

    upsertShadowServerProgressProjection(activeLibraryUserKey, nextProgress)
      .then(() => {
        invalidateSqliteOverlayProjections(queryClient);
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn(
            "[sqlite-progress] Unable to upsert server progress projection during playback",
            error,
          );
        }
      });
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
