export type MainPlayerMediaKind = "book" | "episode";

export const resolveMainPlayerMediaKind = (
  episodeId: string | null | undefined,
): MainPlayerMediaKind => (episodeId ? "episode" : "book");

export const canToggleEpisodePlayback = (payload: {
  hasIdentity: boolean;
  isLoading: boolean;
  hasActivePlaybackControlIntent: boolean;
  canUseServer: boolean;
  hasPlayableLocalDownload: boolean;
}) =>
  payload.hasIdentity &&
  !payload.isLoading &&
  !payload.hasActivePlaybackControlIntent &&
  (payload.canUseServer || payload.hasPlayableLocalDownload);

export const resolveMainPlayerActionIds = (
  kind: MainPlayerMediaKind,
): readonly ("sleepTimer" | "bookmarks" | "addBookmark" | "rate")[] =>
  kind === "episode"
    ? ["sleepTimer", "rate"]
    : ["sleepTimer", "bookmarks", "addBookmark", "rate"];
