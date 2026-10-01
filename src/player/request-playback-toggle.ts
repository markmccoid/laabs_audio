import { playbackStore } from "./playback-store";
import { playerService } from "./player-service";
import { isPlaybackControlTarget, resolvePlaybackControls, type PlaybackControlIdentity } from "./playback-controls-policy";

/** Read at tap time so rapid taps do not repeat the action from an older render. */
export const requestPlaybackToggleForIdentity = (
  identity: PlaybackControlIdentity,
  canStart = true,
  metadata?: { episodeTitle?: string; podcastTitle?: string },
) => {
  const state = playbackStore.getState();
  const isTarget = isPlaybackControlTarget(state, identity);
  const controls = resolvePlaybackControls({ hasIdentity: Boolean(identity.libraryItemId), isTarget,
    requestedPlaybackState: state.requestedPlaybackState,
    isPlaying: isTarget && state.playbackState === "playing",
    isPreparing: isTarget && state.isPreparingPlayback, canStart });
  if (!controls.canToggle || !identity.libraryItemId) return Promise.resolve(undefined);
  if (controls.action === "pause") return playerService.requestPause();
  if (isTarget) return playerService.requestPlay();
  return identity.episodeId
    ? playerService.requestStartEpisode(identity.libraryItemId, identity.episodeId, metadata)
    : playerService.requestStart(identity.libraryItemId);
};
