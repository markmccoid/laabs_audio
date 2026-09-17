const formatAssistantBookmarkPosition = (positionSeconds: number) => {
  const totalSeconds = Number.isFinite(positionSeconds)
    ? Math.max(0, Math.floor(positionSeconds))
    : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const defaultAssistantBookmarkTitle = (
  chapterTitle: string | null,
  positionSeconds: number,
) =>
  `${chapterTitle?.trim() || "Bookmark"} · ${formatAssistantBookmarkPosition(positionSeconds)}`;
