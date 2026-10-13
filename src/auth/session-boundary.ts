import { clearAssistantSurfaceContent } from "../assistant/assistant-surface-lifecycle";
import { getAssistantDownloadedBooks } from "../assistant/assistant-downloaded-books";
import {
  requestAssistantCatalogRebuild,
  setAssistantRebuildCurrentUser,
} from "../data/sqlite/assistant-catalog-rebuild-scheduler";
import { playerService } from "../player/player-service";
import { playbackStore } from "../player/playback-store";
import { queryClient } from "../query/query-client";
import { clearSessionQueryCache } from "../query/session-query-cache";
import { markSwitchGate } from "../utils/switch-trace";
import { authStore } from "./auth-store";
import { libraryActivationStore } from "./library-activation-store";
import { resolveListeningOwnerKey } from "./listening-owner";

const LOCAL_SESSION_ID = "local";
const RETAINED_DOWNLOAD_LIBRARY_FALLBACK = "assistant-retained-downloads";

// Wait briefly so the post-entry SQLite refresh can take over this request (it holds rebuilds
// while writing, then requests one); with nothing to refresh, this request runs on its own.
const ENTRY_ASSISTANT_REBUILD_DELAY_MS = 1_500;

setAssistantRebuildCurrentUser(() => authStore.getState().storedUserId);

/**
 * Schedules the Assistant Catalog rebuild for a newly entered User Session in the background.
 * Entry never waits for it: a full rebuild takes seconds and used to hold Home's cover.
 */
export const scheduleAssistantSurfaceContent = (
  userId: string,
  fallbackLibraryId?: string | null,
) => {
  requestAssistantCatalogRebuild(
    {
      userId,
      downloadedBooks: getAssistantDownloadedBooks(
        userId,
        fallbackLibraryId?.trim() || RETAINED_DOWNLOAD_LIBRARY_FALLBACK,
      ),
      source: "session_entry",
    },
    { delayMs: ENTRY_ASSISTANT_REBUILD_DELAY_MS },
  );
};

// The clear goes through the shared write guard, which may be busy with the previous user's
// refresh. It is queued (FIFO, so still ahead of the next user's rebuild) but not awaited: the
// switch must not wait seconds for another user's background writes.
const queueAssistantSurfaceClear = () => {
  void clearAssistantSurfaceContent()
    .then(() => markSwitchGate("boundary_assistant_cleared"))
    .catch((error) => {
      if (__DEV__) console.warn("[session-boundary] assistant-surface-clear-failed", { error });
    });
};

export const prepareForUserSessionBoundary = async () => {
  queueAssistantSurfaceClear();
  await playerService.endActivePlaybackForLogout().catch((error) => {
    if (__DEV__) {
      console.warn("[session-boundary] player-teardown-failed", { error });
    }
  });
  markSwitchGate("boundary_playback_ended");
  libraryActivationStore.getState().actions.clear();
  await clearSessionQueryCache(queryClient);
  markSwitchGate("boundary_query_cache_cleared");
};

const resolveActivePlaybackOwnerUserId = () =>
  resolveListeningOwnerKey(playbackStore.getState().libraryItemId);

export const prepareForSignInChange = async (target: {
  userId: string | null | undefined;
  sessionKey?: string | null;
}) => {
  const authState = authStore.getState();
  if (target.sessionKey && authState.activeSessionKey === target.sessionKey) {
    return;
  }

  const targetUserId = target.userId?.trim() || null;
  const sourceUserId = resolveActivePlaybackOwnerUserId();
  const isDifferentUser = Boolean(sourceUserId && targetUserId && sourceUserId !== targetUserId);
  if (isDifferentUser) {
    await prepareForUserSessionBoundary();
    return;
  }

  queueAssistantSurfaceClear();

  const playbackState = playbackStore.getState();
  const isStreamingPlayback =
    playbackState.queue.length > 0 &&
    Boolean(playbackState.sessionId) &&
    playbackState.sessionId !== LOCAL_SESSION_ID;

  if (isStreamingPlayback) {
    await playerService.endActivePlaybackForLogout().catch((error) => {
      if (__DEV__) {
        console.warn("[session-boundary] streamed-player-teardown-failed", { error });
      }
    });
  }
};
