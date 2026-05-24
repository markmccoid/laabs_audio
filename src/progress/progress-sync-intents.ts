import type { PendingProgressSync } from "@/store/device-books-store";

export type ProgressSyncIntentKind = NonNullable<PendingProgressSync["intentKind"]>;

export type ProgressSyncIntentTrigger =
  | "pause"
  | "external_pause"
  | "seek"
  | "close"
  | "finish"
  | "natural_completion"
  | "background_app_state"
  | "sync_failure"
  | "interval"
  | "mark_read"
  | "mark_unread";

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
