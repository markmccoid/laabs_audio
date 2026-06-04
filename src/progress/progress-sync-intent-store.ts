import { authStore } from "@/auth/auth-store";
import {
  deviceBooksStore,
  type PendingProgressSync,
} from "@/store/device-books-store";
import type { ProgressLogSessionKind } from "@/store/progress-log-store";
import {
  resolveProgressIntentKind,
  type ProgressSyncIntentKind,
  type ProgressSyncIntentTrigger,
} from "./progress-sync-intents";

const createProgressIntentId = () =>
  `progress_intent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const resolveProgressSyncUserKey = (
  libraryItemId: string,
  override?: string | null,
) => {
  if (override) return override;
  const authState = authStore.getState();
  if (authState.activeLibraryUserKey) return authState.activeLibraryUserKey;
  if (authState.storedUserId) return authState.storedUserId;
  const downloadOwnerUserId =
    deviceBooksStore.getState().downloadedOwnerUserIdsById[libraryItemId]?.[0] ?? null;
  if (downloadOwnerUserId) return downloadOwnerUserId;
  return (
    deviceBooksStore.getState().progressSyncUserKeyByLibraryItemId[libraryItemId] ??
    null
  );
};

export const getPendingProgressSyncIntent = (
  libraryItemId: string,
  userKey?: string | null,
) => {
  const resolvedUserKey = resolveProgressSyncUserKey(libraryItemId, userKey);
  if (!resolvedUserKey) return null;
  return (
    deviceBooksStore.getState().pendingProgressByUser[resolvedUserKey]?.[
      libraryItemId
    ] ?? null
  );
};

export const hasPendingProgressSyncIntent = (userKey?: string | null) => {
  if (userKey) {
    return Object.keys(deviceBooksStore.getState().pendingProgressByUser[userKey] ?? {})
      .length > 0;
  }
  return deviceBooksStore.getState().actions.hasPendingProgressSync();
};

export const recordProgressSyncIntent = (payload: {
  libraryItemId: string;
  mediaItemId?: string | null;
  currentTimeSeconds: number;
  isFinished: boolean;
  trigger: ProgressSyncIntentTrigger | string;
  intentKind?: ProgressSyncIntentKind;
  title?: string | null;
  sessionKind?: ProgressLogSessionKind;
  userKey?: string | null;
  updatedAt?: number;
}) => {
  const userKey = resolveProgressSyncUserKey(payload.libraryItemId, payload.userKey);
  if (!userKey) return null;

  const authState = authStore.getState();
  const updatedAt = payload.updatedAt ?? Date.now();
  const previous = getPendingProgressSyncIntent(payload.libraryItemId, userKey);
  const intentId = previous?.intentId ?? createProgressIntentId();
  const intentKind = resolveProgressIntentKind({
    currentTimeSeconds: payload.currentTimeSeconds,
    isFinished: payload.isFinished,
    explicitKind: payload.intentKind,
  });

  deviceBooksStore.getState().actions.queueProgressSync(
    payload.libraryItemId,
    {
      currentTime: payload.currentTimeSeconds,
      isFinished: payload.isFinished,
      updatedAt,
      intentKind,
      intentId,
      intentCreatedAt: previous?.intentCreatedAt ?? updatedAt,
      mediaItemId: payload.mediaItemId,
    },
    {
      userKey,
      title: payload.title,
      sessionKind: payload.sessionKind,
      trigger: payload.trigger,
      serverUrl: authState.serverUrl,
      username: authState.storedUsername,
    },
  );

  return getPendingProgressSyncIntent(payload.libraryItemId, userKey);
};

export const clearSyncedProgressSyncIntent = (payload: {
  libraryItemId: string;
  userKey?: string | null;
  syncedThroughUpdatedAt: number;
}) => {
  const userKey = resolveProgressSyncUserKey(payload.libraryItemId, payload.userKey);
  if (!userKey) return;

  const current = getPendingProgressSyncIntent(payload.libraryItemId, userKey);
  if (!current) return;
  if (current.updatedAt > payload.syncedThroughUpdatedAt) return;

  deviceBooksStore
    .getState()
    .actions.clearPendingProgressSync(payload.libraryItemId, { userKey });
};

export const getProgressIntentUpdatedAt = (intent: PendingProgressSync | null) =>
  Math.max(0, Math.floor(intent?.updatedAt ?? 0));
