const EPISODE_MENU_TITLE_MAX_CHARACTERS = 52;

export const formatEpisodeMenuTitle = (title?: string) => {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) return undefined;
  if (normalizedTitle.length <= EPISODE_MENU_TITLE_MAX_CHARACTERS) {
    return normalizedTitle;
  }

  const availableTitle = normalizedTitle.slice(
    0,
    EPISODE_MENU_TITLE_MAX_CHARACTERS,
  );
  const lastWordBoundary = availableTitle.lastIndexOf(" ");
  const lastVisibleCharacter = availableTitle.at(-1) ?? "";
  const nextCharacter =
    normalizedTitle.at(EPISODE_MENU_TITLE_MAX_CHARACTERS) ?? "";
  const cutsThroughWord =
    /[\p{L}\p{N}]/u.test(lastVisibleCharacter) &&
    /[\p{L}\p{N}]/u.test(nextCharacter);
  const truncatedTitle =
    cutsThroughWord &&
    lastWordBoundary >= Math.floor(EPISODE_MENU_TITLE_MAX_CHARACTERS * 0.7)
      ? availableTitle.slice(0, lastWordBoundary)
      : availableTitle;

  return `${truncatedTitle.trimEnd()}…`;
};
