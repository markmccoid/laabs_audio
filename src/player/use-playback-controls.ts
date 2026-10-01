import { usePlaybackStore } from "./playback-store";
import { isPlaybackControlTarget, resolvePlaybackControls, type PlaybackControlIdentity } from "./playback-controls-policy";

export const usePlaybackControls = (identity: PlaybackControlIdentity, canStart = true) => {
  const libraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const episodeId = usePlaybackStore((state) => state.episodeId);
  const intent = usePlaybackStore((state) => state.playbackControlIntent);
  const isPreparingPlayback = usePlaybackStore((state) => state.isPreparingPlayback);
  const requestedPlaybackState = usePlaybackStore((state) => state.requestedPlaybackState);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const isTarget = isPlaybackControlTarget({ libraryItemId, episodeId, playbackControlIntent: intent, isPreparingPlayback }, identity);
  const isPreparing = isTarget && isPreparingPlayback;
  return {
    ...resolvePlaybackControls({ hasIdentity: Boolean(identity.libraryItemId), isTarget,
      isPlaying: isTarget && playbackState === "playing", requestedPlaybackState, isPreparing, canStart }),
    isTarget, isPreparing,
  };
};
