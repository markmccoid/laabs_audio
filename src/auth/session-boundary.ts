import { playerService } from "../player/player-service";
import { playbackStore } from "../player/playback-store";
import { queryClient } from "../query/query-client";
import { clearSessionQueryCache } from "../query/session-query-cache";
import { authStore } from "./auth-store";
import { libraryActivationStore } from "./library-activation-store";
import { resolveListeningOwnerKey } from "./listening-owner";

const LOCAL_SESSION_ID = "local";

export const prepareForUserSessionBoundary = async () => {
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
