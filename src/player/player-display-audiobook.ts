import { useShallow } from "zustand/react/shallow";
import type { PlaybackStoreState } from "./playback-store";
import { usePlaybackStore } from "./playback-store";

export type PlayerDisplayAudiobookSource =
  | "playback-start-attempt"
  | "active-playback"
  | "none";

export type PlayerDisplayAudiobook = {
  displayLibraryItemId?: string;
  activeLibraryItemId?: string;
  displayEpisodeId?: string | null;
  displayTitle?: string | null;
  displaySecondaryTitle?: string | null;
  source: PlayerDisplayAudiobookSource;
  isPlaybackStartAttempt: boolean;
  hasActivePlayback: boolean;
  hasLoadedBook: boolean;
  canUseLoadedPlayerActions: boolean;
  isEpisodePlayback: boolean;
};

export const selectPlayerDisplayAudiobook = (
  state: PlaybackStoreState,
): PlayerDisplayAudiobook => {
  const activeLibraryItemId = state.libraryItemId ?? undefined;
  const startIntentLibraryItemId =
    state.playbackControlIntent?.kind === "start"
      ? (state.playbackControlIntent.libraryItemId ?? undefined)
      : undefined;
  const startIntentEpisodeId =
    state.playbackControlIntent?.kind === "start"
      ? (state.playbackControlIntent.episodeId ?? null)
      : null;
  const displayLibraryItemId = startIntentLibraryItemId ?? activeLibraryItemId;
  const displayEpisodeId = startIntentEpisodeId ?? state.episodeId;
  const hasLoadedBook = Boolean(activeLibraryItemId && state.queue.length > 0);
  const hasActivePlayback = hasLoadedBook;
  const source: PlayerDisplayAudiobookSource = startIntentLibraryItemId
    ? "playback-start-attempt"
    : activeLibraryItemId
      ? "active-playback"
      : "none";

  return {
    displayLibraryItemId,
    activeLibraryItemId,
    displayEpisodeId,
    displayTitle: state.bookTitle,
    displaySecondaryTitle: state.secondaryTitle,
    source,
    isPlaybackStartAttempt: source === "playback-start-attempt",
    hasActivePlayback,
    hasLoadedBook,
    canUseLoadedPlayerActions: Boolean(
      displayLibraryItemId && displayLibraryItemId === activeLibraryItemId && hasLoadedBook,
    ),
    isEpisodePlayback: Boolean(displayEpisodeId),
  };
};

export const usePlayerDisplayAudiobook = () =>
  usePlaybackStore(useShallow(selectPlayerDisplayAudiobook));
