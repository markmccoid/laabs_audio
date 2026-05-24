import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "./mmkv-storage";
import { settingsStore } from "./settings-store";

export const MAX_PROGRESS_LOG_ENTRIES = 1000;

export type ProgressLogEventType =
  | "progress_sync_point"
  | "progress_resolution"
  | "queue_sync"
  | "server_progress_fetch"
  | "playback_state_transition"
  | "clip_transcript_export";
export type ProgressLogSessionKind = "streamed" | "downloaded" | "unknown";
export type ProgressSyncPath =
  | "session_sync"
  | "direct_progress_update"
  | "session_sync_then_direct_progress_update"
  | "queue_only"
  | "unknown";
export type ProgressSyncOutcome = "synced_to_server" | "queued_offline" | "queued_after_error";
export type ProgressResolutionSource =
  | "fresh_server_fetch"
  | "persisted_query_cache"
  | "queue"
  | "persisted_playback"
  | "none";
export type QueueSyncAction =
  | "queued"
  | "flush_succeeded"
  | "flush_failed"
  | "flush_skipped";
export type ServerProgressFetchResult =
  | "applied"
  | "ignored_as_stale"
  | "failed"
  | "timed_out";

export type ProgressResolutionCandidate = {
  source: Exclude<ProgressResolutionSource, "none">;
  available: boolean;
  currentTimeSeconds: number | null;
  durationSeconds: number | null;
  isFinished: boolean | null;
  lastUpdate: number | null;
  note?: string;
};

type ProgressLogBase = {
  id: string;
  timestamp: number;
  eventType: ProgressLogEventType;
  libraryItemId: string | null;
  title: string | null;
  sessionKind: ProgressLogSessionKind;
};

export type ProgressSyncPointLogEntry = ProgressLogBase & {
  eventType: "progress_sync_point";
  trigger: string;
  syncPath: ProgressSyncPath;
  outcome: ProgressSyncOutcome;
  currentTimeSeconds: number;
  durationSeconds: number;
  timeListenedSeconds: number;
  isFinished: boolean;
  online: boolean;
  authenticated: boolean;
  hadQueuedProgress: boolean;
  forcedDirectProgressUpdate: boolean;
  closedStreamSession: boolean;
  preventedRegression: boolean;
  errorMessage?: string;
};

export type ProgressResolutionLogEntry = ProgressLogBase & {
  eventType: "progress_resolution";
  trigger: string;
  serverStateSource:
    | "unavailable"
    | "cache_hit"
    | "fetch_success"
    | "fetch_failed"
    | "skipped_fetch";
  chosenSource: ProgressResolutionSource;
  chosenCurrentTimeSeconds: number;
  reason: string;
  candidates: ProgressResolutionCandidate[];
};

export type QueueSyncLogEntry = ProgressLogBase & {
  eventType: "queue_sync";
  trigger: string;
  action: QueueSyncAction;
  intentId?: string | null;
  intentKind?: "position_sample" | "mark_finished" | "mark_unread" | null;
  intentStatus?: "pending" | "unmatched" | null;
  currentTimeSeconds: number;
  isFinished: boolean;
  queuedAt: number | null;
  queueSizeForUser: number;
  originTrigger?: string | null;
  errorMessage?: string;
  note?: string;
};

export type ServerProgressFetchLogEntry = ProgressLogBase & {
  eventType: "server_progress_fetch";
  trigger: string;
  result: ServerProgressFetchResult;
  fetchedCurrentTimeSeconds: number | null;
  cachedCurrentTimeSeconds: number | null;
  fetchedLastUpdate: number | null;
  cachedLastUpdate: number | null;
  errorMessage?: string;
  note?: string;
};

export type PlaybackStateTransitionLogEntry = ProgressLogBase & {
  eventType: "playback_state_transition";
  trigger: string;
  fromPlaybackState: string;
  toPlaybackState: string;
  engineIsPlaying: boolean;
  positionSeconds: number;
  trackPositionSeconds: number;
  durationSeconds: number;
  syncAttempted: boolean;
  syncReason?: string;
  dedupeSkipped: boolean;
  note?: string;
};

export type ClipTranscriptExportLogEntry = ProgressLogBase & {
  eventType: "clip_transcript_export";
  trigger: string;
  result: "failed";
  stage:
    | "restore_listening_position"
    | "transcribe_clip"
    | "create_export_file"
    | "check_sharing"
    | "share_export_file"
    | "unknown";
  bookmarkId: string | null;
  bookmarkTitle: string | null;
  clipStartSeconds: number | null;
  clipEndSeconds: number | null;
  platform: string;
  errorName?: string;
  errorCode?: string;
  errorMessage: string;
};

export type ProgressLogEntry =
  | ProgressSyncPointLogEntry
  | ProgressResolutionLogEntry
  | QueueSyncLogEntry
  | ServerProgressFetchLogEntry
  | PlaybackStateTransitionLogEntry
  | ClipTranscriptExportLogEntry;

type ProgressLogEntryInput =
  | (Omit<ProgressSyncPointLogEntry, "id" | "timestamp"> & { timestamp?: number })
  | (Omit<ProgressResolutionLogEntry, "id" | "timestamp"> & { timestamp?: number })
  | (Omit<QueueSyncLogEntry, "id" | "timestamp"> & { timestamp?: number })
  | (Omit<ServerProgressFetchLogEntry, "id" | "timestamp"> & { timestamp?: number })
  | (Omit<PlaybackStateTransitionLogEntry, "id" | "timestamp"> & { timestamp?: number })
  | (Omit<ClipTranscriptExportLogEntry, "id" | "timestamp"> & { timestamp?: number });

export type ProgressLogState = {
  entries: ProgressLogEntry[];
  actions: {
    appendEntry: (entry: ProgressLogEntryInput) => void;
    clearEntries: () => void;
  };
};

const createLogId = () => `progress_log_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const progressLogStore = createStore<ProgressLogState>()(
  persist(
    (set) => ({
      entries: [],
      actions: {
        appendEntry: (entry) => {
          if (!settingsStore.getState().progressLoggingEnabled) {
            return;
          }

          const timestamp = entry.timestamp ?? Date.now();
          set((state) => {
            const nextEntries = [
              ...state.entries,
              {
                ...entry,
                id: createLogId(),
                timestamp,
              } as ProgressLogEntry,
            ];

            return {
              entries:
                nextEntries.length > MAX_PROGRESS_LOG_ENTRIES
                  ? nextEntries.slice(-MAX_PROGRESS_LOG_ENTRIES)
                  : nextEntries,
            };
          });
        },
        clearEntries: () => set({ entries: [] }),
      },
    }),
    {
      name: "progress-log-store",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        entries: state.entries,
      }),
      version: 1,
    },
  ),
);

export const useProgressLogStore = <T,>(selector: (state: ProgressLogState) => T) =>
  useStore(progressLogStore, selector);

export const useProgressLogActions = () => useProgressLogStore((state) => state.actions);
