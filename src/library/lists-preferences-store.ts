import type { SeriesSortBy, SeriesSortDirection } from "@/sort/series-sort";
import { mmkvStorage } from "@/store/mmkv-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ListsSegment = "series" | "collections" | "playlists";
export type LibraryViewMode = "list" | "grid";

type ListsPreferencesActions = {
  setViewMode: (segment: ListsSegment, viewMode: LibraryViewMode) => void;
  setSeriesSortBy: (sortedBy: SeriesSortBy) => void;
  setSeriesSortDirection: (sortDirection: SeriesSortDirection) => void;
};

type ListsPreferencesState = {
  viewModeBySegment: Record<ListsSegment, LibraryViewMode>;
  seriesSortedBy: SeriesSortBy;
  seriesSortDirection: SeriesSortDirection;
  actions: ListsPreferencesActions;
};

const DEFAULT_VIEW_MODE_BY_SEGMENT: Record<ListsSegment, LibraryViewMode> = {
  series: "list",
  collections: "list",
  playlists: "list",
};

export const useListsPreferencesStore = create<ListsPreferencesState>()(
  persist(
    (set) => ({
      viewModeBySegment: DEFAULT_VIEW_MODE_BY_SEGMENT,
      seriesSortedBy: "name",
      seriesSortDirection: "asc",
      actions: {
        setViewMode: (segment, viewMode) =>
          set((state) => ({
            viewModeBySegment: {
              ...state.viewModeBySegment,
              [segment]: viewMode,
            },
          })),
        setSeriesSortBy: (seriesSortedBy) => set({ seriesSortedBy }),
        setSeriesSortDirection: (seriesSortDirection) => set({ seriesSortDirection }),
      },
    }),
    {
      name: "lists-preferences-storage",
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        viewModeBySegment: state.viewModeBySegment,
        seriesSortedBy: state.seriesSortedBy,
        seriesSortDirection: state.seriesSortDirection,
      }),
      version: 1,
    },
  ),
);

export const useListsViewMode = (segment: ListsSegment) =>
  useListsPreferencesStore((state) => state.viewModeBySegment[segment]);

export const useListsSeriesSortBy = () =>
  useListsPreferencesStore((state) => state.seriesSortedBy);

export const useListsSeriesSortDirection = () =>
  useListsPreferencesStore((state) => state.seriesSortDirection);

export const useListsPreferencesActions = () =>
  useListsPreferencesStore((state) => state.actions);
