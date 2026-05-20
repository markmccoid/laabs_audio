export type ClipPreviewAvailability = {
  available: boolean;
  reason: string | null;
};

export const resolveClipPreviewAvailability = ({
  targetLibraryItemId,
  activeLibraryItemId,
  activeQueueLength,
}: {
  targetLibraryItemId: string | null | undefined;
  activeLibraryItemId: string | null | undefined;
  activeQueueLength: number;
}): ClipPreviewAvailability => {
  if (!targetLibraryItemId) {
    return {
      available: false,
      reason: "Clip preview is unavailable.",
    };
  }

  if (activeLibraryItemId && activeLibraryItemId !== targetLibraryItemId) {
    return {
      available: false,
      reason: "Preview uses the currently loaded book. Start this book to preview its clips.",
    };
  }

  if (!activeLibraryItemId || activeQueueLength <= 0) {
    return {
      available: false,
      reason: "Start this book before previewing clips.",
    };
  }

  return {
    available: true,
    reason: null,
  };
};
