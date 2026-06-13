import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStorage } from "@/store/mmkv-storage";

export type SearchSortBy = "addedAt" | "author" | "title" | "duration" | "publishedYear";
export type SearchSortDirection = "asc" | "desc";
export type SearchFilterOperator = "and" | "or";
export type SearchFavoriteFilter = "all" | "only" | "exclude";
export type SearchResultsViewMode = "list" | "grid";

type SearchSessionState = {
  searchText: string;
  genres: string[];
  genreOperator: SearchFilterOperator;
  tags: string[];
  tagOperator: SearchFilterOperator;
  favoriteFilter: SearchFavoriteFilter;
  finishedOnly: boolean;
  sortedBy: SearchSortBy;
  sortDirection: SearchSortDirection;
  resultsViewMode: SearchResultsViewMode;
  actions: SearchSessionActions;
};

type SearchSessionActions = {
  setSearchText: (value: string) => void;
  setGenres: (genres: string[]) => void;
  addGenre: (genre: string) => void;
  removeGenre: (genre: string) => void;
  clearGenres: () => void;
  setGenreOperator: (operator: SearchFilterOperator) => void;
  setTags: (tags: string[]) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  clearTags: () => void;
  setTagOperator: (operator: SearchFilterOperator) => void;
  setFavoriteFilter: (filter: SearchFavoriteFilter) => void;
  cycleFavoriteFilter: () => void;
  clearFavoriteFilter: () => void;
  toggleFinishedOnly: () => void;
  clearFinishedOnly: () => void;
  setSortedBy: (sortBy: SearchSortBy) => void;
  setSortDirection: (sortDirection: SearchSortDirection) => void;
  setResultsViewMode: (resultsViewMode: SearchResultsViewMode) => void;
};

const DEFAULT_SORTED_BY: SearchSortBy = "addedAt";
const DEFAULT_SORT_DIRECTION: SearchSortDirection = "desc";
const DEFAULT_OPERATOR: SearchFilterOperator = "and";
const DEFAULT_FAVORITE_FILTER: SearchFavoriteFilter = "all";

const addUniqueValue = (values: string[], value: string) =>
  values.includes(value) ? values : [...values, value];

const removeValue = (values: string[], value: string) => values.filter((candidate) => candidate !== value);

export const useSearchSessionStore = create<SearchSessionState>()(
  persist(
    (set) => ({
      searchText: "",
      genres: [],
      genreOperator: DEFAULT_OPERATOR,
      tags: [],
      tagOperator: DEFAULT_OPERATOR,
      favoriteFilter: DEFAULT_FAVORITE_FILTER,
      finishedOnly: false,
      sortedBy: DEFAULT_SORTED_BY,
      sortDirection: DEFAULT_SORT_DIRECTION,
      resultsViewMode: "list",
      actions: {
        setSearchText: (searchText) => set({ searchText }),
        setGenres: (genres) => set({ genres }),
        addGenre: (genre) => set((state) => ({ genres: addUniqueValue(state.genres, genre) })),
        removeGenre: (genre) => set((state) => ({ genres: removeValue(state.genres, genre) })),
        clearGenres: () => set({ genres: [] }),
        setGenreOperator: (genreOperator) => set({ genreOperator }),
        setTags: (tags) => set({ tags }),
        addTag: (tag) => set((state) => ({ tags: addUniqueValue(state.tags, tag) })),
        removeTag: (tag) => set((state) => ({ tags: removeValue(state.tags, tag) })),
        clearTags: () => set({ tags: [] }),
        setTagOperator: (tagOperator) => set({ tagOperator }),
        setFavoriteFilter: (favoriteFilter) => set({ favoriteFilter }),
        cycleFavoriteFilter: () =>
          set((state) => {
            switch (state.favoriteFilter) {
              case "all":
                return { favoriteFilter: "only" as const };
              case "only":
                return { favoriteFilter: "exclude" as const };
              case "exclude":
              default:
                return { favoriteFilter: DEFAULT_FAVORITE_FILTER };
            }
          }),
        clearFavoriteFilter: () => set({ favoriteFilter: DEFAULT_FAVORITE_FILTER }),
        toggleFinishedOnly: () => set((state) => ({ finishedOnly: !state.finishedOnly })),
        clearFinishedOnly: () => set({ finishedOnly: false }),
        setSortedBy: (sortedBy) => set({ sortedBy }),
        setSortDirection: (sortDirection) => set({ sortDirection }),
        setResultsViewMode: (resultsViewMode) => set({ resultsViewMode }),
      },
    }),
    {
      name: "search-session-storage",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        genreOperator: state.genreOperator,
        tagOperator: state.tagOperator,
        sortedBy: state.sortedBy,
        sortDirection: state.sortDirection,
        resultsViewMode: state.resultsViewMode,
      }),
    },
  ),
);

export const useSearchText = () => useSearchSessionStore((state) => state.searchText);
export const useSearchGenres = () => useSearchSessionStore((state) => state.genres);
export const useSearchGenreOperator = () =>
  useSearchSessionStore((state) => state.genreOperator);
export const useSearchTags = () => useSearchSessionStore((state) => state.tags);
export const useSearchTagOperator = () => useSearchSessionStore((state) => state.tagOperator);
export const useSearchFavoriteFilter = () =>
  useSearchSessionStore((state) => state.favoriteFilter);
export const useSearchFinishedOnly = () => useSearchSessionStore((state) => state.finishedOnly);
export const useSearchSortedBy = () => useSearchSessionStore((state) => state.sortedBy);
export const useSearchSortDirection = () =>
  useSearchSessionStore((state) => state.sortDirection);
export const useSearchResultsViewMode = () =>
  useSearchSessionStore((state) => state.resultsViewMode);
export const useSearchSessionActions = () => useSearchSessionStore((state) => state.actions);
