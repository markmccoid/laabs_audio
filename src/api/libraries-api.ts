import { absClient } from "./abs-client";
import { authStore } from "../auth/auth-store";
import type { FilterData, Library, PersonalizedViewsResponse } from "../types/absTypes";

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

const resolveLibraryId = (libraryId?: string | null) =>
  libraryId ?? authStore.getState().activeLibraryId;

export const librariesApi = {
  getAll() {
    return absClient.get<LibrariesResponse>("/api/libraries");
  },

  async getFilterData(libraryId?: string | null): Promise<LibraryFilterData> {
    const libraryIdToUse = resolveLibraryId(libraryId);

    if (!libraryIdToUse || typeof libraryIdToUse !== "string" || libraryIdToUse.trim() === "") {
      throw new Error("No library ID available for filter data request");
    }

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

  getPersonalized(libraryId: string, options: { limit?: number } = {}) {
    const limit = options.limit ?? 16;
    return absClient.get<PersonalizedViewsResponse>(
      `/api/libraries/${libraryId}/personalized?limit=${limit}`,
    );
  },
};
