export type ClipPreviewAvailability = {
  available: boolean;
  reason: string | null;
};

export const resolveClipPreviewAvailability = ({
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
}): ClipPreviewAvailability => {
  if (!targetLibraryItemId) {
    return {
      available: false,
      reason: "Clip preview is unavailable.",
    };
  }

  if (
    activeLibraryItemId &&
    (activeLibraryItemId !== targetLibraryItemId ||
      (targetEpisodeId ?? null) !== (activeEpisodeId ?? null))
  ) {
    return {
      available: false,
      reason: "Preview uses the currently loaded media. Start this item to preview its clips.",
    };
  }

  if (!activeLibraryItemId || activeQueueLength <= 0) {
    return {
      available: false,
      reason: "Start this item before previewing clips.",
    };
  }

  return {
    available: true,
    reason: null,
  };
};
