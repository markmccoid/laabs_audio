import * as Linking from "expo-linking";
import type { Href } from "expo-router";

// Returns the internal Expo Router href object for navigation to the Home book detail screen.
export const getBookDetailHref = (libraryItemId: string): Href => ({
  pathname: "/(tabs)/(home)/[libraryItemId]",
  params: { libraryItemId },
});

// Returns the public deep link that can be shared outside the app.
// Route groups like `(tabs)` and `(home)` are omitted from the URL, so the shared path is `/${libraryItemId}`.
export const createSharedBookLink = (libraryItemId: string) =>
  Linking.createURL(`/${libraryItemId}`);

const RESERVED_ROOT_SEGMENTS = new Set([
  "(tabs)",
  "login",
  "library-picker",
  "chapter-viewer",
  "main-player",
  "player-rate",
  "player-bookmarks",
  "player-sleep-timer",
  "book-bookshelves",
  "book-downloads",
  "book-bookmarks",
  "book-addbookmark",
  "book-series",
  "book-filter-results",
]);
// Matches the internal Expo Router path form used during navigation state, e.g.
// `/(tabs)/(home)/12345`, and captures the trailing `libraryItemId`.
const NESTED_BOOK_ROUTE_PATTERN = /(?:^|\/)\(tabs\)\/\(home\)\/([^/?#]+)/;
// Matches the public shared-link path form, e.g. `/12345`, after leading/trailing
// slashes are stripped. The capture excludes `/`, `?`, `#`, and route-group parens.
const ROOT_BOOK_ROUTE_PATTERN = /^([^/?#()]+)$/;

// Extracts a `libraryItemId` from either the internal Expo Router path form or the
// public shared-link form so cold-start deep-link handling can recover the book destination.
export const extractBookDetailIdFromUrl = (url?: string | null) => {
  if (!url) return undefined;

  const parsed = Linking.parse(url);
  const pathCandidates = [parsed.path, url];

  for (const candidate of pathCandidates) {
    if (!candidate) continue;

    const nestedMatched = candidate.match(NESTED_BOOK_ROUTE_PATTERN);
    if (nestedMatched?.[1]) {
      return decodeURIComponent(nestedMatched[1]);
    }

    const normalizedCandidate = candidate.replace(/^\/+|\/+$/g, "");
    const rootMatched = normalizedCandidate.match(ROOT_BOOK_ROUTE_PATTERN);
    if (rootMatched?.[1] && !RESERVED_ROOT_SEGMENTS.has(rootMatched[1])) {
      return decodeURIComponent(rootMatched[1]);
    }
  }

  return undefined;
};
