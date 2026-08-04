export type TemporaryPlaybackAvailability = {
  available: boolean;
  reason: string | null;
};

export const resolveTemporaryPlaybackAvailability = ({
  targetLibraryItemId,
  targetEpisodeId = null,
  activeLibraryItemId,
  activeEpisodeId = null,
  activeQueueLength,
}: {
  targetLibraryItemId: string | null | undefined;
  targetEpisodeId?: string | null;
  activeLibraryItemId: string | null | undefined;
  activeEpisodeId?: string | null;
  activeQueueLength: number;
}): TemporaryPlaybackAvailability => {
  if (!targetLibraryItemId) {
    return {
      available: false,
      reason: "Temporary playback is unavailable.",
    };
  }

  if (
    activeLibraryItemId &&
    (activeLibraryItemId !== targetLibraryItemId ||
      (targetEpisodeId ?? null) !== (activeEpisodeId ?? null))
  ) {
    return {
      available: false,
      reason: "Load this item to play bookmarks without moving progress.",
    };
  }

  if (!activeLibraryItemId || activeQueueLength <= 0) {
    return {
      available: false,
      reason: "Load this item to play bookmarks without moving progress.",
    };
  }

  return {
    available: true,
    reason: null,
  };
};
