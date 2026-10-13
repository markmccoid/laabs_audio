import type { UserBookProgress } from "@/api/me-api";
import { resolveNativeResumePosition } from "@/player/listening-position-policy";
import type { ListeningPositionRecord } from "./native-listening-position";

/**
 * Continue Listening for owned Downloaded Audio Assets while no User Session is active
 * (Downloaded-Only / Imported-Only Mode). The SQLite home projection is unavailable then, so each
 * download's progress is rebuilt from what survives logout: the download owner's SQLite progress
 * (server snapshot + pending intents) and the native Listening Position record. The position rule
 * is the player's `resolveNativeResumePosition`, so the shelf shows where playback will resume.
 */

/** The download owner's stored progress for one book (SQLite `effective_progress`). */
export type StoredLocalProgress = {
  currentTime: number;
  duration: number;
  isFinished: boolean;
  hideFromContinueListening: boolean;
  startedAt: number;
  finishedAt: number | null;
  lastUpdate: number;
  /** Kind and time of a pending Progress Sync Intent, when one exists. */
  pendingIntentKind: string | null;
  pendingUpdatedAt: number | null;
};

export type LocalProgressInput = {
  libraryItemId: string;
  durationSeconds: number;
  stored: StoredLocalProgress | null;
  native: Pick<
    ListeningPositionRecord,
    "positionMs" | "durationMs" | "isFinished" | "sequence" | "syncedThroughSequence" | "committedAt"
  > | null;
};

const msToSeconds = (ms: number) => ms / 1000;
const FINISHED_TOLERANCE_SECONDS = 3;

export const resolveLocalBookProgress = (input: LocalProgressInput): UserBookProgress | null => {
  const { stored, native, libraryItemId } = input;
  if (!stored && !native) return null;

  const duration = Math.max(
    input.durationSeconds,
    stored?.duration ?? 0,
    native ? msToSeconds(native.durationMs) : 0,
  );
  const storedPositionMs = Math.max(0, (stored?.currentTime ?? 0) * 1000);
  const markedUnread =
    stored?.pendingIntentKind === "mark_unread" &&
    (!native || (stored.pendingUpdatedAt ?? 0) > native.committedAt);

  const positionMs = native
    ? resolveNativeResumePosition({
        fallbackPositionMs: storedPositionMs,
        nativePositionMs: native.positionMs,
        nativeSequence: native.sequence,
        syncedThroughSequence: native.syncedThroughSequence,
        pendingExplicitPositionMs: markedUnread ? 0 : null,
      })
    : markedUnread
      ? 0
      : storedPositionMs;
  const currentTime = msToSeconds(positionMs);

  const nativeIsNewer = Boolean(native && native.committedAt >= (stored?.lastUpdate ?? 0));
  const isFinished = markedUnread
    ? false
    : nativeIsNewer
      ? native!.isFinished ||
        (duration > 0 && currentTime >= duration - FINISHED_TOLERANCE_SECONDS)
      : Boolean(stored?.isFinished);
  const lastUpdate = Math.max(stored?.lastUpdate ?? 0, native?.committedAt ?? 0);

  return {
    progressId: `${libraryItemId}:local`,
    libraryItemId,
    duration,
    progressPercent: duration > 0 ? Math.min(1, currentTime / duration) : 0,
    currentTime,
    isFinished,
    hideFromContinueListening: stored?.hideFromContinueListening ?? false,
    startedAt: stored?.startedAt ?? lastUpdate,
    finishedAt: isFinished ? (stored?.finishedAt ?? lastUpdate) : null,
    lastUpdate,
  };
};

/** In-progress books, most recently listened first. */
export const selectLocalContinueListeningIds = (
  progressByBookId: Record<string, UserBookProgress>,
): string[] =>
  Object.values(progressByBookId)
    .filter(
      (progress) =>
        !progress.isFinished && !progress.hideFromContinueListening && progress.currentTime > 0,
    )
    .sort((left, right) => right.lastUpdate - left.lastUpdate)
    .map((progress) => progress.libraryItemId);
