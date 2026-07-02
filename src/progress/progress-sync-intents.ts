import type { PendingProgressSync } from "@/store/device-books-store";

export type ProgressSyncIntentKind = NonNullable<PendingProgressSync["intentKind"]>;

export type ProgressSyncIntentTrigger =
  | "pause"
  | "external_pause"
  | "seek"
  | "auto_rewind"
  | "close"
  | "finish"
  | "natural_completion"
  | "download_deleted"
  | "background_app_state"
  | "sync_failure"
  | "interval"
  | "mark_read"
  | "mark_unread"
  | "logout";

export const resolveProgressIntentKind = (payload: {
  currentTimeSeconds: number;
  isFinished: boolean;
  explicitKind?: ProgressSyncIntentKind;
}): ProgressSyncIntentKind => {
  if (payload.explicitKind) return payload.explicitKind;
  if (payload.isFinished) return "mark_finished";
  return "position_sample";
};

export const shouldCreateDurableProgressIntentBeforeSync = (
  trigger: ProgressSyncIntentTrigger,
) => trigger !== "interval";
