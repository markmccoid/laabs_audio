import { absClient } from "./abs-client";
import type { FilterData, Library } from "../types/absTypes";

export type LibrariesResponse = {
  libraries: Library[];
};

export type LibraryFilterData = {
  id: string;
  genres: { name: string; b64Encoded: string }[];
  tags: { name: string; b64Encoded: string }[];
  authors: ({ id: string; name: string } & { base64encoded: string })[];
  series: ({ id: string; name: string } & { base64encoded: string })[];
};

const requireLibraryId = (libraryId: string, requestName: string) => {
  const trimmed = libraryId.trim();
  if (!trimmed) {
    throw new Error(`${requestName} requires a libraryId`);
  }
  return trimmed;
};

export const librariesApi = {
  getAll() {
    return absClient.get<LibrariesResponse>("/api/libraries");
  },

  async getFilterData(libraryId: string): Promise<LibraryFilterData> {
    const libraryIdToUse = requireLibraryId(libraryId, "librariesApi.getFilterData");

    const response = await absClient.get<FilterData>(
      `/api/libraries/${libraryIdToUse}/filterdata`,
    );

    const genres = response.genres.map((genre) => ({
      name: genre,
      b64Encoded: btoa(genre),
    }));
    const tags = response.tags.map((tag) => ({
      name: tag,
      b64Encoded: btoa(tag),
    }));
    const authors = response.authors.map((author) => ({
      ...author,
      base64encoded: btoa(author.id),
    }));
    const series = response.series.map((seriesItem) => ({
      ...seriesItem,
      base64encoded: btoa(seriesItem.id),
    }));

    return { id: libraryIdToUse, genres, tags, authors, series };
  },
};
