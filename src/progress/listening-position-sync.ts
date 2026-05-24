import { AbsApiError } from "@/api/abs-client";
import { meApi } from "@/api/me-api";
import { sessionsApi } from "@/api/sessions-api";
import { authStore } from "@/auth/auth-store";
import type { PlaybackStoreState } from "@/player/playback-store";
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

export const syncListeningPosition = async (payload: {
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
}) => {
  const { state } = payload;
  if (!state.libraryItemId || !state.sessionId) return null;

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

  const result: ListeningPositionSyncResult = {
    syncedToServer,
    syncPath,
    syncOutcome,
    syncErrorMessage,
    online,
    authenticated,
    hadQueuedProgress,
    clearedIntentThroughUpdatedAt,
  };
  return result;
};
