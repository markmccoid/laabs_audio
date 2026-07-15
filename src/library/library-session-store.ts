import { mmkvStorage } from "@/store/mmkv-storage";
import type { CatalogSortBy, CatalogSortDirection } from "@/sort/catalog-sort";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type LibrarySortBy = CatalogSortBy;
export type LibrarySortDirection = CatalogSortDirection;

type LibrarySessionState = {
  searchText: string;
  sortedBy: LibrarySortBy;
  sortDirection: LibrarySortDirection;
  actions: LibrarySessionActions;
};

type LibrarySessionActions = {
  setSearchText: (value: string) => void;
  setSortedBy: (value: LibrarySortBy) => void;
  setSortDirection: (value: LibrarySortDirection) => void;
  clearSearchText: () => void;
};

export const useLibrarySessionStore = create<LibrarySessionState>()(
  persist(
    (set) => ({
      searchText: "",
      sortedBy: "title",
      sortDirection: "asc",
      actions: {
        setSearchText: (searchText) => set({ searchText }),
        setSortedBy: (sortedBy) => set({ sortedBy }),
        setSortDirection: (sortDirection) => set({ sortDirection }),
        clearSearchText: () => set({ searchText: "" }),
      },
    }),
    {
      name: "library-session-storage",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        sortedBy: state.sortedBy,
        sortDirection: state.sortDirection,
      }),
    },
  ),
);

export const useLibrarySearchText = () => useLibrarySessionStore((state) => state.searchText);
export const useLibrarySortedBy = () => useLibrarySessionStore((state) => state.sortedBy);
export const useLibrarySortDirection = () =>
  useLibrarySessionStore((state) => state.sortDirection);
export const useLibrarySessionActions = () => useLibrarySessionStore((state) => state.actions);
