/**
 * Root-stack route classification for the auth/startup navigation gate.
 */

const PLAYER_UTILITY_SHEETS = new Set([
  "player-rate",
  "player-bookmarks",
  "player-sleep-timer",
  "player-ambient",
]);

const BOOK_UTILITY_SHEETS = new Set([
  "book-bookshelves",
  "book-downloads",
  "book-bookmarks",
  "book-bookmark-detail",
  "book-addbookmark",
  "book-series",
  "book-filter-results",
]);

const EPISODE_UTILITY_SHEETS = new Set([
  "episode-bookshelves",
  "episode-downloads",
  "episode-bookmarks",
  "episode-bookmark-detail",
  "episode-addbookmark",
]);

export type AuthenticatedRouteState = {
  rootSegment: string | undefined;
  inLogin: boolean;
  inTabs: boolean;
  inLibraryPicker: boolean;
  inChapterViewer: boolean;
  inMainPlayer: boolean;
  inPlayerUtilitySheet: boolean;
  inBookUtilitySheet: boolean;
  inEpisodeUtilitySheet: boolean;
};

/** Collapse the current top-level route into flags the navigation gate can reason about. */
export const getAuthenticatedRouteState = (
  segments: readonly string[],
): AuthenticatedRouteState => {
  const rootSegment = segments[0];

  return {
    rootSegment,
    inLogin: rootSegment === "login",
    inTabs: rootSegment === "(tabs)",
    inLibraryPicker: rootSegment === "library-picker",
    inChapterViewer: rootSegment === "chapter-viewer",
    inMainPlayer: rootSegment === "main-player",
    inPlayerUtilitySheet: Boolean(rootSegment && PLAYER_UTILITY_SHEETS.has(rootSegment)),
    inBookUtilitySheet: Boolean(rootSegment && BOOK_UTILITY_SHEETS.has(rootSegment)),
    inEpisodeUtilitySheet: Boolean(rootSegment && EPISODE_UTILITY_SHEETS.has(rootSegment)),
  };
};

/** True when the root segment is an allowed authenticated destination (not sent Home). */
export const isKnownAuthenticatedRoute = (routeState: AuthenticatedRouteState) =>
  routeState.inLogin ||
  routeState.inTabs ||
  routeState.inLibraryPicker ||
  routeState.inChapterViewer ||
  routeState.inMainPlayer ||
  routeState.inPlayerUtilitySheet ||
  routeState.inBookUtilitySheet ||
  routeState.inEpisodeUtilitySheet;
