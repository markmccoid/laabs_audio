import { absClient } from "./abs-client";

export type SeriesWithProgress = {
  id: string;
  name: string;
  progress?: {
    libraryItemIds: string[];
    libraryItemIdsFinished: string[];
    isFinished: boolean;
  };
};

export const seriesApi = {
  async getSeriesWithProgress(seriesId: string): Promise<SeriesWithProgress> {
    if (!seriesId || !seriesId.trim()) {
      throw new Error("Series ID is required");
    }

    return absClient.get<SeriesWithProgress>(`/api/series/${seriesId}?include=progress`);
  },
};
