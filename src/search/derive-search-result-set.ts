import type { LibrarySearchIndex, SearchSortKey } from "./library-search-index";
import { normalizeSearchQueryTokens } from "./library-search-index";
import type {
  SearchFavoriteFilter,
  SearchFilterOperator,
  SearchSortBy,
  SearchSortDirection,
} from "./search-session-store";

export type SearchResultQuery = {
  searchText: string;
  genres: string[];
  genreOperator: SearchFilterOperator;
  tags: string[];
  tagOperator: SearchFilterOperator;
  favoriteFilter: SearchFavoriteFilter;
  finishedOnly: boolean;
  sortedBy: SearchSortBy;
  sortDirection: SearchSortDirection;
  favoriteIds: Set<string>;
  finishedIds: Set<string>;
};

export type SearchResultSet = {
  resultIds: string[];
  matchingIds: Set<string>;
};

const isDev = () => typeof __DEV__ !== "undefined" && __DEV__;

const now = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const logPerformance = (label: string, payload: Record<string, number | string>) => {
  if (!isDev()) return;
  console.log("[search-performance]", label, payload);
};

const intersectSets = (left: Set<string>, right: Set<string>) => {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  const result = new Set<string>();
  smaller.forEach((id) => {
    if (larger.has(id)) {
      result.add(id);
    }
  });
  return result;
};

const unionSets = (sets: Set<string>[]) => {
  const result = new Set<string>();
  sets.forEach((set) => {
    set.forEach((id) => result.add(id));
  });
  return result;
};

const applyFacet = (
  current: Set<string>,
  selectedValues: string[],
  operator: SearchFilterOperator,
  facetIndex: Map<string, Set<string>>,
) => {
  if (selectedValues.length === 0) {
    return current;
  }

  const selectedSets = selectedValues.map((value) => facetIndex.get(value) ?? new Set<string>());
  const facetMatches =
    operator === "or"
      ? unionSets(selectedSets)
      : selectedSets.reduce<Set<string> | null>(
          (acc, selectedSet) => (acc ? intersectSets(acc, selectedSet) : new Set(selectedSet)),
          null,
        ) ?? new Set<string>();

  return intersectSets(current, facetMatches);
};

const applySearchText = (
  current: Set<string>,
  index: LibrarySearchIndex,
  searchText: string,
) => {
  const tokens = normalizeSearchQueryTokens(searchText);
  if (tokens.length === 0) {
    return current;
  }

  const result = new Set<string>();
  current.forEach((id) => {
    const searchableText = index.searchTextById.get(id) ?? "";
    if (tokens.every((token) => searchableText.includes(token))) {
      result.add(id);
    }
  });
  return result;
};

const applyFavoriteFilter = (
  current: Set<string>,
  favoriteFilter: SearchFavoriteFilter,
  favoriteIds: Set<string>,
) => {
  if (favoriteFilter === "all") {
    return current;
  }

  const result = new Set<string>();
  current.forEach((id) => {
    const isFavorite = favoriteIds.has(id);
    if (
      (favoriteFilter === "only" && isFavorite) ||
      (favoriteFilter === "exclude" && !isFavorite)
    ) {
      result.add(id);
    }
  });
  return result;
};

const applyFinishedFilter = (
  current: Set<string>,
  finishedOnly: boolean,
  finishedIds: Set<string>,
) => {
  if (!finishedOnly) {
    return current;
  }
  return intersectSets(current, finishedIds);
};

const projectSortedResults = (
  index: LibrarySearchIndex,
  matchingIds: Set<string>,
  sortedBy: SearchSortBy,
  sortDirection: SearchSortDirection,
) => {
  const sortKey: SearchSortKey = `${sortedBy}:${sortDirection}`;
  const sortedIds = index.sortedIdsBySort[sortKey] ?? index.allIds;
  return sortedIds.filter((id) => matchingIds.has(id));
};

export const deriveSearchResultSet = (
  index: LibrarySearchIndex,
  query: SearchResultQuery,
): SearchResultSet => {
  const startedAt = now();
  let matchingIds = new Set(index.playableIds);

  matchingIds = applySearchText(matchingIds, index, query.searchText);
  matchingIds = applyFacet(matchingIds, query.genres, query.genreOperator, index.genreIdsByValue);
  matchingIds = applyFacet(matchingIds, query.tags, query.tagOperator, index.tagIdsByValue);
  matchingIds = applyFavoriteFilter(matchingIds, query.favoriteFilter, query.favoriteIds);
  matchingIds = applyFinishedFilter(matchingIds, query.finishedOnly, query.finishedIds);

  const projectedAt = now();
  const resultIds = projectSortedResults(index, matchingIds, query.sortedBy, query.sortDirection);
  const completedAt = now();

  logPerformance("derive", {
    items: index.allIds.length,
    matches: matchingIds.size,
    results: resultIds.length,
    matchMs: Math.round(projectedAt - startedAt),
    projectMs: Math.round(completedAt - projectedAt),
    totalMs: Math.round(completedAt - startedAt),
  });

  return { resultIds, matchingIds };
};
