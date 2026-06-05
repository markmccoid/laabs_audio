import type { LibraryItemSummary, LibraryItemsSummary } from "@/api/library-items-api";
import type { SearchSortBy, SearchSortDirection } from "./search-session-store";

export type SearchSortKey = `${SearchSortBy}:${SearchSortDirection}`;

export type LibrarySearchIndex = {
  itemById: Map<string, LibraryItemSummary>;
  allIds: string[];
  playableIds: Set<string>;
  searchTextById: Map<string, string>;
  genreIdsByValue: Map<string, Set<string>>;
  tagIdsByValue: Map<string, Set<string>>;
  sortedIdsBySort: Record<SearchSortKey, string[]>;
};

const SORT_KEYS: SearchSortBy[] = ["addedAt", "author", "title", "duration", "publishedYear"];
const SORT_DIRECTIONS: SearchSortDirection[] = ["asc", "desc"];

const normalizeText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const buildSearchText = (book: LibraryItemSummary) =>
  [
    book.title,
    book.subtitle,
    book.author,
    book.narratedBy,
    book.seriesName ?? book.series,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");

const addToFacetIndex = (
  index: Map<string, Set<string>>,
  values: string[] | null | undefined,
  id: string,
) => {
  values?.forEach((value) => {
    const existing = index.get(value);
    if (existing) {
      existing.add(id);
      return;
    }
    index.set(value, new Set([id]));
  });
};

const numberValue = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const stringValue = (value: string | null | undefined) => normalizeText(value);

const publishedYearValue = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareBySort = (
  left: LibraryItemSummary,
  right: LibraryItemSummary,
  sortBy: SearchSortBy,
) => {
  switch (sortBy) {
    case "addedAt":
      return numberValue(left.addedAt) - numberValue(right.addedAt);
    case "duration":
      return numberValue(left.duration) - numberValue(right.duration);
    case "publishedYear":
      return publishedYearValue(left.publishedYear) - publishedYearValue(right.publishedYear);
    case "author": {
      const authorCompare = stringValue(left.author).localeCompare(stringValue(right.author));
      return authorCompare || stringValue(left.title).localeCompare(stringValue(right.title));
    }
    case "title":
    default:
      return stringValue(left.title).localeCompare(stringValue(right.title));
  }
};

const buildSortedIds = (
  books: LibraryItemsSummary,
  sortBy: SearchSortBy,
  sortDirection: SearchSortDirection,
) => {
  const sorted = [...books].sort((left, right) => {
    const sortCompare = compareBySort(left, right, sortBy);
    if (sortCompare !== 0) {
      return sortDirection === "desc" ? -sortCompare : sortCompare;
    }
    return left.id.localeCompare(right.id);
  });

  return sorted.map((book) => book.id);
};

export const buildLibrarySearchIndex = (books: LibraryItemsSummary): LibrarySearchIndex => {
  const itemById = new Map<string, LibraryItemSummary>();
  const allIds: string[] = [];
  const playableIds = new Set<string>();
  const searchTextById = new Map<string, string>();
  const genreIdsByValue = new Map<string, Set<string>>();
  const tagIdsByValue = new Map<string, Set<string>>();

  books.forEach((book) => {
    itemById.set(book.id, book);
    allIds.push(book.id);
    searchTextById.set(book.id, buildSearchText(book));
    addToFacetIndex(genreIdsByValue, book.genres, book.id);
    addToFacetIndex(tagIdsByValue, book.tags, book.id);

    if ((book.numAudioFiles ?? 0) > 0) {
      playableIds.add(book.id);
    }
  });

  const sortedIdsBySort = SORT_KEYS.reduce(
    (acc, sortBy) => {
      SORT_DIRECTIONS.forEach((sortDirection) => {
        acc[`${sortBy}:${sortDirection}`] = buildSortedIds(books, sortBy, sortDirection);
      });
      return acc;
    },
    {} as Record<SearchSortKey, string[]>,
  );

  return {
    itemById,
    allIds,
    playableIds,
    searchTextById,
    genreIdsByValue,
    tagIdsByValue,
    sortedIdsBySort,
  };
};

export const normalizeSearchQueryTokens = (query: string) =>
  normalizeText(query).split(" ").filter(Boolean);
