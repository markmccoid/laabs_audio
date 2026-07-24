import { AbsApiError } from "@/api/abs-client";
import { meApi } from "@/api/me-api";
import { sessionsApi } from "@/api/sessions-api";
import { authStore } from "@/auth/auth-store";
import type { PlaybackStoreState } from "@/player/playback-store";
import {
  clearEpisodeProgressSyncIntent,
  getEpisodeProgressSyncIntent,
  markEpisodeProgressSyncUnmatched,
  recordEpisodeProgressSyncIntent,
} from "@/podcast/episode-progress-intent-store";
import type {
  ProgressLogSessionKind,
  ProgressSyncOutcome,
  ProgressSyncPath,
} from "@/store/progress-log-store";
import {
  clearSyncedProgressSyncIntent,
  getProgressIntentUpdatedAt,
  hasPendingProgressSyncIntent,
  recordProgressSyncIntent,
} from "./progress-sync-intent-store";
import {
  shouldCreateDurableProgressIntentBeforeSync,
  type ProgressSyncIntentKind,
  type ProgressSyncIntentTrigger,
} from "./progress-sync-intents";

const LOCAL_SESSION_ID = "local";

export type ListeningPositionSyncResult = {
  syncedToServer: boolean;
  syncPath: ProgressSyncPath;
  syncOutcome: ProgressSyncOutcome;
  syncErrorMessage?: string;
  online: boolean;
  authenticated: boolean;
  hadQueuedProgress: boolean;
  clearedIntentThroughUpdatedAt: number | null;
};

type SyncPayload = {
  state: PlaybackStoreState;
  reason: ProgressSyncIntentTrigger;
  currentTimeSeconds: number;
  durationSeconds: number;
  timeListenedSeconds: number;
  isFinished: boolean;
  title: string | null;
  sessionKind: ProgressLogSessionKind;
  closeStreamSession?: boolean;
  forceDirectProgressUpdate?: boolean;
  intentKind?: ProgressSyncIntentKind;
  updateLocalProgress: (progress: {
    libraryItemId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    isFinished: boolean;
  }) => void;
  setLastSyncAt: (timestamp: number) => void;
};

const syncEpisodeListeningPosition = async (
  payload: SyncPayload,
): Promise<ListeningPositionSyncResult | null> => {
  const { state } = payload;
  if (!state.libraryItemId || !state.episodeId || !state.sessionId) return null;

  const shouldRecordBeforeSync = shouldCreateDurableProgressIntentBeforeSync(payload.reason);
  const syncStartedAt = Date.now();
  const recordedIntent = shouldRecordBeforeSync
    ? recordEpisodeProgressSyncIntent({
        libraryItemId: state.libraryItemId,
        episodeId: state.episodeId,
        currentTimeSeconds: payload.currentTimeSeconds,
        durationSeconds: payload.durationSeconds,
        isFinished: payload.isFinished,
        trigger: payload.reason,
        title: payload.title,
        podcastTitle: state.secondaryTitle,
      })
    : null;
  const syncBarrierUpdatedAt = recordedIntent?.updatedAt ?? syncStartedAt;

  const authState = authStore.getState();
  const online = authState.isOnline !== false;
  const authenticated = authState.status === "authenticated";
  const hadQueuedProgress =
    Boolean(recordedIntent) ||
    Boolean(getEpisodeProgressSyncIntent(state.libraryItemId, state.episodeId));
  const shouldCloseStreamSession = Boolean(
    payload.closeStreamSession && state.sessionId !== LOCAL_SESSION_ID,
  );
  let syncedToServer = false;
  let syncPath: ProgressSyncPath = "queue_only";
  let syncOutcome: ProgressSyncOutcome = "queued_offline";
  let syncErrorMessage: string | undefined;
  let clearedIntentThroughUpdatedAt: number | null = null;

  const queueAfterFailure = (trigger: string) => {
    recordEpisodeProgressSyncIntent({
      libraryItemId: state.libraryItemId as string,
      episodeId: state.episodeId as string,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
      trigger,
      title: payload.title,
      podcastTitle: state.secondaryTitle,
    });
  };

  try {
    if (online && authenticated) {
      if (shouldCloseStreamSession) {
        try {
          await sessionsApi.closeSession(state.sessionId, {
            timeListened: payload.timeListenedSeconds,
            currentTime: payload.currentTimeSeconds,
            duration: payload.durationSeconds || undefined,
          });
        } catch (error) {
          if (!(error instanceof AbsApiError && error.status === 404) && __DEV__) {
            console.warn("[listening-position-sync] episode-close-session-failed", error);
          }
        }
      }

      const shouldUseProgressUpdateApi =
        Boolean(payload.forceDirectProgressUpdate) ||
        shouldCloseStreamSession ||
        state.sessionId === LOCAL_SESSION_ID ||
        hadQueuedProgress;

      if (shouldUseProgressUpdateApi) {
        syncPath = "direct_progress_update";
        try {
          await meApi.updateEpisodeProgress(state.libraryItemId, state.episodeId, {
            currentTime: payload.currentTimeSeconds,
            isFinished: payload.isFinished,
          });
          syncedToServer = true;
        } catch (error) {
          if (error instanceof AbsApiError && error.status === 404) {
            markEpisodeProgressSyncUnmatched({
              libraryItemId: state.libraryItemId,
              episodeId: state.episodeId,
            });
          }
          throw error;
        }
      } else {
        syncPath = "session_sync";
        const syncResult = await sessionsApi.syncSession(state.sessionId, {
          timeListened: payload.timeListenedSeconds,
          currentTime: payload.currentTimeSeconds,
          duration: payload.durationSeconds || undefined,
        });
        if (syncResult.success) {
          syncedToServer = true;
        } else {
          syncPath = "session_sync_then_direct_progress_update";
          await meApi.updateEpisodeProgress(state.libraryItemId, state.episodeId, {
            currentTime: payload.currentTimeSeconds,
            isFinished: payload.isFinished,
          });
          syncedToServer = true;
        }
      }
    }

    if (syncedToServer) {
      syncOutcome = "synced_to_server";
      clearEpisodeProgressSyncIntent({
        libraryItemId: state.libraryItemId,
        episodeId: state.episodeId,
        syncedThroughUpdatedAt: syncBarrierUpdatedAt,
      });
      clearedIntentThroughUpdatedAt = syncBarrierUpdatedAt;
      payload.setLastSyncAt(Date.now());
    } else if (!shouldRecordBeforeSync) {
      queueAfterFailure(payload.reason);
    }

    payload.updateLocalProgress({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
    });
  } catch (error) {
    syncOutcome = "queued_after_error";
    syncErrorMessage = error instanceof Error ? error.message : "Unknown sync error";
    queueAfterFailure("sync_failure");
    payload.updateLocalProgress({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
    });
  }

  return {
    syncedToServer,
    syncPath,
    syncOutcome,
    syncErrorMessage,
    online,
    authenticated,
    hadQueuedProgress,
    clearedIntentThroughUpdatedAt,
  };
};

export const syncListeningPosition = async (payload: SyncPayload) => {
  const { state } = payload;
  if (!state.libraryItemId || !state.sessionId) return null;

  if (state.episodeId) {
    return syncEpisodeListeningPosition(payload);
  }

  const shouldRecordBeforeSync = shouldCreateDurableProgressIntentBeforeSync(
    payload.reason,
  );
  const syncStartedAt = Date.now();
  const recordedIntent = shouldRecordBeforeSync
    ? recordProgressSyncIntent({
        libraryItemId: state.libraryItemId,
        currentTimeSeconds: payload.currentTimeSeconds,
        isFinished: payload.isFinished,
        trigger: payload.reason,
        intentKind: payload.intentKind,
        title: payload.title,
        sessionKind: payload.sessionKind,
      })
    : null;
  const syncBarrierUpdatedAt =
    getProgressIntentUpdatedAt(recordedIntent) || syncStartedAt;

  const authState = authStore.getState();
  const online = authState.isOnline !== false;
  const authenticated = authState.status === "authenticated";
  const hadQueuedProgress =
    Boolean(recordedIntent) || hasPendingProgressSyncIntent();
  const shouldCloseStreamSession = Boolean(
    payload.closeStreamSession && state.sessionId !== LOCAL_SESSION_ID,
  );
  let syncedToServer = false;
  let syncPath: ProgressSyncPath = "queue_only";
  let syncOutcome: ProgressSyncOutcome = "queued_offline";
  let syncErrorMessage: string | undefined;
  let clearedIntentThroughUpdatedAt: number | null = null;

  const queueAfterFailure = (trigger: ProgressSyncIntentTrigger | string) => {
    recordProgressSyncIntent({
      libraryItemId: state.libraryItemId as string,
      currentTimeSeconds: payload.currentTimeSeconds,
      isFinished: payload.isFinished,
      trigger,
      intentKind: payload.intentKind,
      title: payload.title,
      sessionKind: payload.sessionKind,
    });
  };

  try {
    if (online && authenticated) {
      if (shouldCloseStreamSession) {
        try {
          await sessionsApi.closeSession(state.sessionId, {
            timeListened: payload.timeListenedSeconds,
            currentTime: payload.currentTimeSeconds,
            duration: payload.durationSeconds || undefined,
          });
        } catch (error) {
          if (!(error instanceof AbsApiError && error.status === 404) && __DEV__) {
            console.warn("[listening-position-sync] close-session-failed", {
              reason: payload.reason,
              libraryItemId: state.libraryItemId,
              sessionId: state.sessionId,
              error,
            });
          }
        }
      }

      const shouldUseProgressUpdateApi =
        Boolean(payload.forceDirectProgressUpdate) ||
        shouldCloseStreamSession ||
        state.sessionId === LOCAL_SESSION_ID ||
        hadQueuedProgress;

      if (shouldUseProgressUpdateApi) {
        syncPath = "direct_progress_update";
        await meApi.updateProgress(state.libraryItemId, {
          currentTime: payload.currentTimeSeconds,
          isFinished: payload.isFinished,
        });
        syncedToServer = true;
      } else {
        syncPath = "session_sync";
        const syncResult = await sessionsApi.syncSession(state.sessionId, {
          timeListened: payload.timeListenedSeconds,
          currentTime: payload.currentTimeSeconds,
          duration: payload.durationSeconds || undefined,
        });
        if (syncResult.success) {
          syncedToServer = true;
        } else {
          syncPath = "session_sync_then_direct_progress_update";
          await meApi.updateProgress(state.libraryItemId, {
            currentTime: payload.currentTimeSeconds,
            isFinished: payload.isFinished,
          });
          syncedToServer = true;
        }
      }
    }

    if (syncedToServer) {
      syncOutcome = "synced_to_server";
      clearSyncedProgressSyncIntent({
        libraryItemId: state.libraryItemId,
        syncedThroughUpdatedAt: syncBarrierUpdatedAt,
      });
      clearedIntentThroughUpdatedAt = syncBarrierUpdatedAt;
      payload.setLastSyncAt(Date.now());
    } else if (!shouldRecordBeforeSync) {
      queueAfterFailure(payload.reason);
    }

    payload.updateLocalProgress({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
    });
  } catch (error) {
    syncOutcome = "queued_after_error";
    syncErrorMessage = error instanceof Error ? error.message : "Unknown sync error";
    queueAfterFailure("sync_failure");
    payload.updateLocalProgress({
      libraryItemId: state.libraryItemId,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
    });
    if (__DEV__) {
      console.warn("[listening-position-sync] queued-after-sync-error", {
        reason: payload.reason,
        libraryItemId: state.libraryItemId,
        sessionId: state.sessionId,
        error,
      });
    }
  }

  return {
    syncedToServer,
    syncPath,
    syncOutcome,
    syncErrorMessage,
    online,
    authenticated,
    hadQueuedProgress,
    clearedIntentThroughUpdatedAt,
  };
};
