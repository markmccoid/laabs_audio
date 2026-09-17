import { clearAssistantSurfaceContent } from "../assistant/assistant-surface-lifecycle";
import { getAssistantDownloadedBooks } from "../assistant/assistant-downloaded-books";
import { rebuildAssistantCatalog } from "../data/sqlite/assistant-catalog-writes";
import { playerService } from "../player/player-service";
import { playbackStore } from "../player/playback-store";
import { queryClient } from "../query/query-client";
import { clearSessionQueryCache } from "../query/session-query-cache";
import { authStore } from "./auth-store";
import { libraryActivationStore } from "./library-activation-store";
import { resolveListeningOwnerKey } from "./listening-owner";

const LOCAL_SESSION_ID = "local";
const RETAINED_DOWNLOAD_LIBRARY_FALLBACK = "assistant-retained-downloads";

export const replaceAssistantSurfaceContent = async (
  userId: string,
  fallbackLibraryId?: string | null,
) => {
  try {
    await rebuildAssistantCatalog({
      userId,
      downloadedBooks: getAssistantDownloadedBooks(
        userId,
        fallbackLibraryId?.trim() || RETAINED_DOWNLOAD_LIBRARY_FALLBACK,
      ),
    });
  } catch (error) {
    if (__DEV__) console.warn("[session-boundary] assistant-surface-rebuild-failed", { error });
  }
};

export const prepareForUserSessionBoundary = async () => {
  await clearAssistantSurfaceContent().catch((error) => {
    if (__DEV__) console.warn("[session-boundary] assistant-surface-clear-failed", { error });
  });
  await playerService.endActivePlaybackForLogout().catch((error) => {
    if (__DEV__) {
      console.warn("[session-boundary] player-teardown-failed", { error });
    }
  });
  libraryActivationStore.getState().actions.clear();
  await clearSessionQueryCache(queryClient);
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

  await clearAssistantSurfaceContent().catch((error) => {
    if (__DEV__) console.warn("[session-boundary] assistant-surface-clear-failed", { error });
  });

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
