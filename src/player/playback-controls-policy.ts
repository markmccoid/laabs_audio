import type { PlaybackStoreState } from "./playback-store";

export type PlaybackControlIdentity = {
  libraryItemId?: string | null;
  episodeId?: string | null;
};

/** Preparation owns the incoming identity before its session metadata is committed. */
export const isPlaybackControlTarget = (
  state: Pick<PlaybackStoreState, "libraryItemId" | "episodeId" | "playbackControlIntent" | "isPreparingPlayback">,
  identity: PlaybackControlIdentity,
) => {
  const preparation = state.isPreparingPlayback && state.playbackControlIntent?.kind === "start"
    ? state.playbackControlIntent : null;
  const target = preparation ?? state;
  return Boolean(identity.libraryItemId && target.libraryItemId === identity.libraryItemId &&
    (target.episodeId ?? null) === (identity.episodeId ?? null));
};

/** A pending request changes the next action immediately; it never disables its opposite. */
export const resolvePlaybackControls = (payload: {
  hasIdentity: boolean;
  isPlaying: boolean;
  requestedPlaybackState?: "playing" | "paused" | null;
  isTarget?: boolean;
  isPreparing?: boolean;
  canStart?: boolean;
}) => {
  const isTarget = payload.isTarget ?? true;
  const wantsPlaying = isTarget && (payload.requestedPlaybackState
    ? payload.requestedPlaybackState === "playing" : payload.isPlaying);
  return {
    canToggle: payload.hasIdentity && (wantsPlaying || (isTarget && payload.isPreparing) || (payload.canStart ?? true)),
    action: wantsPlaying ? "pause" as const : "play" as const,
  };
};
