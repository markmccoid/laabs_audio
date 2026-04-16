import type { QueryClient } from "@tanstack/react-query";
import {
  normalizeUserProgressByLibraryItemId,
  type UserBookProgress,
  type UserServerState,
  meApi,
} from "@/api/me-api";
import { playbackStore } from "@/player/playback-store";
import { queryKeys } from "@/query/query-keys";
import { deviceBooksStore } from "@/store/device-books-store";

const MISSING_PROGRESS_PRESERVE_MS = 15 * 60 * 1000;

type ReconcileProgressContext = {
  now: number;
  preserveMissingProgressMs: number;
  playbackLibraryItemId: string | null;
  playbackPositionSeconds: number;
  queuedLibraryItemIds: Set<string>;
};

const toProgressLastUpdate = (progress?: Pick<UserBookProgress, "lastUpdate"> | null) =>
  Math.max(0, Math.floor(progress?.lastUpdate ?? 0));

const toProgressCurrentTime = (progress?: Pick<UserBookProgress, "currentTime"> | null) =>
  Math.max(0, Math.floor(progress?.currentTime ?? 0));

const hasMeaningfulProgress = (progress?: UserBookProgress | null) =>
  toProgressCurrentTime(progress) > 0 || Boolean(progress?.isFinished);

const shouldPreserveMissingProgress = (
  previousProgress: UserBookProgress,
  context: ReconcileProgressContext,
) => {
  if (!hasMeaningfulProgress(previousProgress)) {
    return false;
  }

  if (context.queuedLibraryItemIds.has(previousProgress.libraryItemId)) {
    return true;
  }

  const hasPlaybackEvidence =
    context.playbackLibraryItemId === previousProgress.libraryItemId &&
    context.playbackPositionSeconds > 0;
  if (hasPlaybackEvidence) {
    return true;
  }

  const previousLastUpdate = toProgressLastUpdate(previousProgress);
  if (previousLastUpdate <= 0) {
    return false;
  }

  return context.now - previousLastUpdate <= context.preserveMissingProgressMs;
};

const pickPreferredProgress = (
  previousProgress: UserBookProgress | null,
  incomingProgress: UserBookProgress | null,
  context: ReconcileProgressContext,
) => {
  if (!previousProgress) return incomingProgress;
  if (!incomingProgress) {
    return shouldPreserveMissingProgress(previousProgress, context) ? previousProgress : null;
  }

  const previousLastUpdate = toProgressLastUpdate(previousProgress);
  const incomingLastUpdate = toProgressLastUpdate(incomingProgress);
  if (incomingLastUpdate > previousLastUpdate) {
    return incomingProgress;
  }
  if (incomingLastUpdate < previousLastUpdate) {
    return previousProgress;
  }

  const previousCurrentTime = toProgressCurrentTime(previousProgress);
  const incomingCurrentTime = toProgressCurrentTime(incomingProgress);
  if (incomingCurrentTime > previousCurrentTime) {
    return incomingProgress;
  }
  if (incomingCurrentTime < previousCurrentTime) {
    return previousProgress;
  }

  if (Boolean(incomingProgress.isFinished) !== Boolean(previousProgress.isFinished)) {
    return incomingProgress.isFinished ? incomingProgress : previousProgress;
  }

  if (
    Boolean(incomingProgress.hideFromContinueListening) !==
    Boolean(previousProgress.hideFromContinueListening)
  ) {
    return incomingProgress.hideFromContinueListening ? incomingProgress : previousProgress;
  }

  return incomingProgress;
};

export const reconcileUserServerState = (
  previousState: UserServerState | undefined,
  incomingState: UserServerState,
  context: ReconcileProgressContext,
): UserServerState => {
  const previousProgressByLibraryItemId = normalizeUserProgressByLibraryItemId(previousState);
  const incomingProgressByLibraryItemId = normalizeUserProgressByLibraryItemId(incomingState);
  const reconciledProgressByLibraryItemId: Record<string, UserBookProgress> = {};
  const libraryItemIds = new Set<string>([
    ...Object.keys(previousProgressByLibraryItemId),
    ...Object.keys(incomingProgressByLibraryItemId),
  ]);

  libraryItemIds.forEach((libraryItemId) => {
    const preferredProgress = pickPreferredProgress(
      previousProgressByLibraryItemId[libraryItemId] ?? null,
      incomingProgressByLibraryItemId[libraryItemId] ?? null,
      context,
    );
    if (preferredProgress) {
      reconciledProgressByLibraryItemId[libraryItemId] = preferredProgress;
    }
  });

  return {
    ...incomingState,
    progressByLibraryItemId: reconciledProgressByLibraryItemId,
  };
};

export const fetchReconciledUserServerState = async (
  queryClient: QueryClient,
  activeLibraryUserKey: string,
) => {
  const queryKey = queryKeys.userServerState(activeLibraryUserKey);
  const previousState = queryClient.getQueryData<UserServerState>(queryKey);
  const incomingState = await meApi.getUserServerState();
  const queuedProgressByLibraryItemId =
    deviceBooksStore.getState().pendingProgressByUser[activeLibraryUserKey] ?? {};
  const playbackState = playbackStore.getState();

  return reconcileUserServerState(previousState, incomingState, {
    now: Date.now(),
    preserveMissingProgressMs: MISSING_PROGRESS_PRESERVE_MS,
    playbackLibraryItemId: playbackState.libraryItemId ?? null,
    playbackPositionSeconds: Math.max(0, Math.floor(playbackState.positionMs / 1000)),
    queuedLibraryItemIds: new Set(Object.keys(queuedProgressByLibraryItemId)),
  });
};
