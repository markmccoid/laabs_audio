import type { PlaybackStoreState } from "./playback-store";

export type PlayerDisplaySource =
  | "playback-start-attempt"
  | "active-playback"
  | "none";

export type PlayerDisplayMedia = {
  displayLibraryItemId?: string;
  activeLibraryItemId?: string;
  displayEpisodeId?: string | null;
  displayTitle?: string | null;
  displaySecondaryTitle?: string | null;
  source: PlayerDisplaySource;
  isPlaybackStartAttempt: boolean;
  hasActivePlayback: boolean;
  hasLoadedMedia: boolean;
  canUseLoadedPlayerActions: boolean;
  isEpisodePlayback: boolean;
};

export const selectPlayerDisplayMedia = (
  state: PlaybackStoreState,
): PlayerDisplayMedia => {
  const activeLibraryItemId = state.libraryItemId ?? undefined;
  const startIntent =
    state.playbackControlIntent?.kind === "start" ? state.playbackControlIntent : null;
  const startIntentLibraryItemId = startIntent?.libraryItemId ?? undefined;
  const displayLibraryItemId = startIntentLibraryItemId ?? activeLibraryItemId;
  // A start intent owns the complete incoming media identity. In particular,
  // `episodeId: null` means "start a Book" and must not fall through to the
  // Episode ID from the outgoing Active Playback.
  const displayEpisodeId = startIntentLibraryItemId
    ? (startIntent?.episodeId ?? null)
    : state.episodeId;
  const hasLoadedMedia = Boolean(activeLibraryItemId && state.queue.length > 0);
  const hasActivePlayback = hasLoadedMedia;
  const source: PlayerDisplaySource = startIntentLibraryItemId
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
    hasLoadedMedia,
    canUseLoadedPlayerActions: Boolean(
      displayLibraryItemId && displayLibraryItemId === activeLibraryItemId && hasLoadedMedia,
    ),
    isEpisodePlayback: Boolean(displayEpisodeId),
  };
};
