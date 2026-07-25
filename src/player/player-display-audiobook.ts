import { useShallow } from "zustand/react/shallow";
import type { PlaybackStoreState } from "./playback-store";
import { usePlaybackStore } from "./playback-store";
import {
  selectPlayerDisplayMedia,
  type PlayerDisplayMedia,
  type PlayerDisplaySource,
} from "./player-display-media";

export const usePlayerDisplayMedia = () =>
  usePlaybackStore(useShallow(selectPlayerDisplayMedia));

/** @deprecated Use PlayerDisplaySource. */
export type PlayerDisplayAudiobookSource = PlayerDisplaySource;
/** @deprecated Use PlayerDisplayMedia. */
export type PlayerDisplayAudiobook = PlayerDisplayMedia & {
  hasLoadedBook: boolean;
};
/** @deprecated Use selectPlayerDisplayMedia. */
export const selectPlayerDisplayAudiobook = (
  state: PlaybackStoreState,
): PlayerDisplayAudiobook => {
  const media = selectPlayerDisplayMedia(state);
  return { ...media, hasLoadedBook: media.hasLoadedMedia };
};
/** @deprecated Use usePlayerDisplayMedia. */
export const usePlayerDisplayAudiobook = () =>
  usePlaybackStore(useShallow(selectPlayerDisplayAudiobook));
