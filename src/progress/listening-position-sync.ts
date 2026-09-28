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
  getPendingProgressSyncIntent,
  recordProgressSyncIntent,
} from "./progress-sync-intent-store";
import {
  shouldCreateDurableProgressIntentBeforeSync,
  type ProgressSyncIntentKind,
  type ProgressSyncIntentTrigger,
} from "./progress-sync-intents";
import { nativeListeningPosition } from "./native-listening-position";
import { claimListeningSync } from "./listening-position-order";

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
export type ListeningPositionSyncPayload = {
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
  serverUrl?: string | null;
  isCurrentPlayback?: () => boolean;
  updateLocalProgress: (progress: {
    libraryItemId: string;
    currentTimeSeconds: number;
    durationSeconds: number;
    isFinished: boolean;
  }) => void;
  setLastSyncAt: (timestamp: number) => void;
};

/** Project once before the network await; late responses never write listening position. */
export const syncListeningPosition = async (
  input: ListeningPositionSyncPayload,
): Promise<ListeningPositionSyncResult | null> => {
  const state = { ...input.state };
  if (!state.libraryItemId || !state.sessionId) return null;
  const auth = authStore.getState();
  const ownerId =
    state.ownerId ?? auth.activeLibraryUserKey ?? auth.storedUserId;
  if (!ownerId)
    throw new Error(
      "Listening position sync requires its frozen listener identity.",
    );
  const scope = {
    ownerId,
    libraryItemId: state.libraryItemId,
    episodeId: state.episodeId ?? null,
  };
  const payload = { ...input, state };
  const ticket = claimListeningSync(scope);
  const serverUrl =
    input.serverUrl !== undefined ? input.serverUrl : auth.serverUrl;
  const activeSessionKey = auth.activeSessionKey;
  const online = auth.isOnline !== false;
  const authenticated = auth.status === "authenticated";
  const isRouteCurrent = () => {
    const current = authStore.getState();
    return (
      (current.activeLibraryUserKey ?? current.storedUserId) === ownerId &&
      current.serverUrl === serverUrl &&
      current.activeSessionKey === activeSessionKey
    );
  };
  const pending = () =>
    scope.episodeId
      ? getEpisodeProgressSyncIntent(
          scope.libraryItemId,
          scope.episodeId,
          ownerId,
        )
      : getPendingProgressSyncIntent(scope.libraryItemId, ownerId);
  let nativeSequence = state.positionSequence ?? null;
  // The sequence belongs to the position sent, never to a newer receipt read after a reply.
  if (
    nativeSequence !== null &&
    (!Number.isSafeInteger(nativeSequence) || nativeSequence < 1)
  )
    nativeSequence = null;
  if (nativeListeningPosition.capability() === "native") {
    const receipt = await nativeListeningPosition.get(scope);
    if (
      !ticket.isLatest() ||
      (receipt &&
        state.positionRevision != null &&
        receipt.positionRevision > state.positionRevision)
    ) {
      return {
        syncedToServer: false,
        syncPath: "queue_only",
        syncOutcome: "queued_after_error",
        syncErrorMessage:
          "Listening position was superseded by a newer confirmed command",
        online,
        authenticated,
        hadQueuedProgress: Boolean(pending()),
        clearedIntentThroughUpdatedAt: null,
      };
    }
    if (
      nativeSequence === null &&
      receipt &&
      Math.abs(receipt.positionMs / 1000 - payload.currentTimeSeconds) < 1 &&
      receipt.isFinished === payload.isFinished
    )
      nativeSequence = receipt.sequence;
  }

  const previousIntent = pending();
  const recordIntent = (trigger: string) =>
    scope.episodeId
      ? recordEpisodeProgressSyncIntent({
          ...scope,
          episodeId: scope.episodeId,
          userKey: ownerId,
          currentTimeSeconds: payload.currentTimeSeconds,
          durationSeconds: payload.durationSeconds,
          isFinished: payload.isFinished,
          trigger,
          title: payload.title,
          podcastTitle: state.secondaryTitle,
        })
      : recordProgressSyncIntent({
          libraryItemId: scope.libraryItemId,
          userKey: ownerId,
          currentTimeSeconds: payload.currentTimeSeconds,
          durationSeconds: payload.durationSeconds,
          isFinished: payload.isFinished,
          trigger,
          intentKind: payload.intentKind,
          title: payload.title,
          sessionKind: payload.sessionKind,
          updatedAt: ticket.updatedAt,
          serverUrl,
          username: auth.storedUsername,
        });
  const shouldRecord = shouldCreateDurableProgressIntentBeforeSync(
    payload.reason,
  );
  const recordedIntent = shouldRecord ? recordIntent(payload.reason) : null;
  const syncBarrier =
    recordedIntent?.updatedAt ?? previousIntent?.updatedAt ?? ticket.updatedAt;
  const hadQueuedProgress = Boolean(recordedIntent || previousIntent);
  const capturedIntent = recordedIntent ?? previousIntent;
  const intentFingerprint = (intent: ReturnType<typeof pending>) => {
    if (!intent) return null;
    const position =
      "currentTimeSeconds" in intent
        ? intent.currentTimeSeconds
        : intent.currentTime;
    return JSON.stringify([
      intent.intentId,
      intent.updatedAt,
      position,
      intent.isFinished,
      intent.intentKind,
    ]);
  };
  const capturedFingerprint = intentFingerprint(capturedIntent);
  const canAffectCurrentIntent = () => {
    const current = pending();
    return (
      ticket.isLatest() &&
      (current?.updatedAt ?? 0) <= syncBarrier &&
      (current === null || intentFingerprint(current) === capturedFingerprint)
    );
  };
  if (isRouteCurrent() && ticket.isLatest())
    payload.updateLocalProgress({
      libraryItemId: scope.libraryItemId,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      isFinished: payload.isFinished,
    });

  return ticket.serialize(async () => {
    let syncPath: ProgressSyncPath = "queue_only";
    let syncOutcome: ProgressSyncOutcome = "queued_offline";
    let syncedToServer = false;
    let syncErrorMessage: string | undefined;
    let clearedIntentThroughUpdatedAt: number | null = null;
    const controller = new AbortController();
    const unsubscribe = authStore.subscribe?.(() => {
      if (!isRouteCurrent())
        controller.abort(new Error("Listening sync owner or endpoint changed"));
    });
    const assertRoute = () => {
      if (!isRouteCurrent() || controller.signal.aborted)
        throw new Error("Listening sync owner or endpoint changed");
    };
    const requestOptions = { signal: controller.signal };
    const updateServer = async () => {
      assertRoute();
      const progress = {
        currentTime: payload.currentTimeSeconds,
        isFinished: payload.isFinished,
      };
      if (scope.episodeId)
        await meApi.updateEpisodeProgress(
          scope.libraryItemId,
          scope.episodeId,
          progress,
          requestOptions,
        );
      else
        await meApi.updateProgress(
          scope.libraryItemId,
          progress,
          requestOptions,
        );
    };
    try {
      if (online && authenticated && ticket.isLatest()) {
        assertRoute();
        if (nativeListeningPosition.capability() === "native") {
          const receipt = await nativeListeningPosition.get(scope);
          if (
            receipt &&
            state.positionRevision != null &&
            receipt.positionRevision > state.positionRevision
          ) {
            throw new Error(
              "Listening position was superseded by a newer confirmed command",
            );
          }
          if (
            nativeSequence === null &&
            receipt &&
            Math.abs(receipt.positionMs / 1000 - payload.currentTimeSeconds) <
              1 &&
            receipt.isFinished === payload.isFinished
          )
            nativeSequence = receipt.sequence;
        }
        assertRoute();
        const closeSession = Boolean(
          payload.closeStreamSession && state.sessionId !== LOCAL_SESSION_ID,
        );
        if (closeSession) {
          try {
            await sessionsApi.closeSession(
              state.sessionId!,
              {
                timeListened: payload.timeListenedSeconds,
                currentTime: payload.currentTimeSeconds,
                duration: payload.durationSeconds || undefined,
              },
              requestOptions,
            );
          } catch (error) {
            assertRoute();
            if (
              !(error instanceof AbsApiError && error.status === 404) &&
              __DEV__
            )
              console.warn("[listening-position-sync] close-session-failed");
          }
        }
        assertRoute();
        if (
          payload.forceDirectProgressUpdate ||
          closeSession ||
          state.sessionId === LOCAL_SESSION_ID ||
          hadQueuedProgress
        ) {
          syncPath = "direct_progress_update";
          await updateServer();
        } else {
          syncPath = "session_sync";
          const result = await sessionsApi.syncSession(
            state.sessionId!,
            {
              timeListened: payload.timeListenedSeconds,
              currentTime: payload.currentTimeSeconds,
              duration: payload.durationSeconds || undefined,
            },
            requestOptions,
          );
          assertRoute();
          if (!result.success) {
            syncPath = "session_sync_then_direct_progress_update";
            await updateServer();
          }
        }
        syncedToServer = true;
        syncOutcome = "synced_to_server";
        if (isRouteCurrent() && canAffectCurrentIntent()) {
          if (scope.episodeId)
            clearEpisodeProgressSyncIntent({
              ...scope,
              episodeId: scope.episodeId,
              userKey: ownerId,
              syncedThroughUpdatedAt: syncBarrier,
            });
          else
            clearSyncedProgressSyncIntent({
              libraryItemId: scope.libraryItemId,
              userKey: ownerId,
              syncedThroughUpdatedAt: syncBarrier,
            });
          clearedIntentThroughUpdatedAt = syncBarrier;
          if (!payload.isCurrentPlayback || payload.isCurrentPlayback())
            payload.setLastSyncAt(Date.now());
        }
        if (nativeSequence !== null && isRouteCurrent()) {
          try {
            await nativeListeningPosition.acknowledge(
              scope,
              nativeSequence,
              "synced",
            );
          } catch (error) {
            // The committed record remains available for replay, and diagnostics expose the failed receipt.
            syncErrorMessage = `Local sync acknowledgement failed: ${error instanceof Error ? error.message : "Unknown storage error"}`;
          }
        }
      } else if (!shouldRecord && canAffectCurrentIntent())
        recordIntent(payload.reason);
    } catch (error) {
      syncOutcome = "queued_after_error";
      syncErrorMessage =
        error instanceof Error ? error.message : "Unknown sync error";
      if (canAffectCurrentIntent()) {
        if (
          scope.episodeId &&
          error instanceof AbsApiError &&
          error.status === 404
        ) {
          if (!pending()) recordIntent("sync_failure");
          markEpisodeProgressSyncUnmatched({
            ...scope,
            episodeId: scope.episodeId,
            userKey: ownerId,
          });
        } else recordIntent("sync_failure");
      }
    } finally {
      unsubscribe?.();
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
  });
};
