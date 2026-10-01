import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import type { PlaybackStoreState } from "./playback-store";
import { usePlaybackStore } from "./playback-store";
import { usePlaybackControlIntentBlocking } from "./use-playback-control-intent-blocking";
import {
  selectPlayerDisplayMedia,
  type PlayerDisplayMedia,
  type PlayerDisplaySource,
} from "./player-display-media";

export const usePlayerDisplayMedia = () => {
  const intent = usePlaybackStore((state) => state.playbackControlIntent);
  // The deadline subscription reselects even if a background timer left the
  // exact same start-intent object in the store.
  usePlaybackControlIntentBlocking(intent);
  return usePlaybackStore(useShallow(selectPlayerDisplayMedia));
};

/** @deprecated Use PlayerDisplaySource. */
export type PlayerDisplayAudiobookSource = PlayerDisplaySource;
/** @deprecated Use PlayerDisplayMedia. */
export type PlayerDisplayAudiobook = PlayerDisplayMedia & {
  hasLoadedBook: boolean;
};
/** @deprecated Use selectPlayerDisplayMedia. */
export const selectPlayerDisplayAudiobook = (
  state: PlaybackStoreState,
  nowMs = Date.now(),
): PlayerDisplayAudiobook => {
  const media = selectPlayerDisplayMedia(state, nowMs);
  return { ...media, hasLoadedBook: media.hasLoadedMedia };
};
/** @deprecated Use usePlayerDisplayMedia. */
export const usePlayerDisplayAudiobook = () => {
  const media = usePlayerDisplayMedia();
  return useMemo(() => ({ ...media, hasLoadedBook: media.hasLoadedMedia }), [media]);
};
