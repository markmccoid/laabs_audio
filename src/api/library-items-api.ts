import type { GetLibraryItemsResponse, LibraryItem } from "../types/absTypes";
import { absClient } from "./abs-client";
import { buildCoverUrls } from "./cover-urls";
import { favoritesApi } from "./favorites-api";

export type FilterType = "genres" | "tags" | "authors" | "series" | "progress";

export type GetLibraryItemsParams = {
  libraryId: string;
  filterType?: FilterType;
  filterValue?: string;
  sortBy?: string;
  sortDesc?: boolean;
  page?: number;
  limit?: number;
};

export type LibraryItemSummary = {
  id: string;
  title: string;
  subtitle?: string | undefined | null;
  author?: string | undefined | null;
  seriesName?: string | undefined | null;
  series?: string | undefined | null;
  publishedDate?: string | undefined | null;
  publishedYear?: string | undefined | null;
  narratedBy?: string | undefined | null;
  description?: string | undefined | null;
  duration: number;
  addedAt: number;
  updatedAt: number;
  cover: string;
  coverFull: string;
  numAudioFiles: number | undefined | null;
  ebookFormat: string | undefined | null;
  genres: string[];
  tags: string[];
  asin?: string | null;
  isFavorite?: boolean;
};

export type LibraryItemsSummary = LibraryItemSummary[];

export type LibraryItemsSummaryPage = {
  results: LibraryItemsSummary;
  total: number;
  limit: number;
  page: number;
};

export type FavoriteOrFinishedItem = {
  itemId: string;
  title: string;
  author: string;
  imageURL: string;
  type: ("isFavorite" | "isRead")[];
};

const requireLibraryId = (libraryId: string, requestName: string) => {
  const trimmed = libraryId.trim();
  if (!trimmed) {
    throw new Error(`${requestName} requires a libraryId`);
  }
  return trimmed;
};

export const libraryItemsApi = {
  toSummary(item: LibraryItem): LibraryItemSummary {
    const coverUrls = buildCoverUrls(item.id);

    return {
      id: item.id,
      title: item.media.metadata.title,
      subtitle: item.media.metadata.subtitle,
      author: item.media.metadata.authorName,
      seriesName: item.media.metadata.seriesName,
      series: item.media.metadata.seriesName,
      publishedDate: item.media.metadata.publishedDate,
      publishedYear: item.media.metadata.publishedYear,
      narratedBy: item.media.metadata.narratorName,
      description: item.media.metadata.description,
      duration: item.media.duration,
      addedAt: item.addedAt,
      updatedAt: item.updatedAt,
      cover: coverUrls.thumb,
      coverFull: coverUrls.full,
      numAudioFiles: item.media.numAudioFiles,
      ebookFormat: item.media?.ebookFormat,
      genres: item.media.metadata.genres,
      tags: item.media.tags,
      asin: item.media.metadata.asin,
    };
  },

  async getItemsPage(params: GetLibraryItemsParams): Promise<LibraryItemsSummaryPage> {
    const { filterType, filterValue, sortBy, page, limit } = params;
    const libraryId = requireLibraryId(params.libraryId, "libraryItemsApi.getItemsPage");

    const query = new URLSearchParams();

    if (filterType && filterValue) {
      query.set("filter", `${filterType}.${filterValue}`);
    }

    if (sortBy) {
      query.set("sort", sortBy);
      if (params.sortDesc) {
        query.set("desc", "1");
      }
    }

    if (typeof page === "number") {
      query.set("page", String(page));
    }

    if (typeof limit === "number") {
      query.set("limit", String(limit));
    }

    const suffix = query.toString();
    const url = `/api/libraries/${libraryId}/items${suffix ? `?${suffix}` : ""}`;
    const responseData = await absClient.get<GetLibraryItemsResponse>(url);

    return {
      results: responseData.results.map(libraryItemsApi.toSummary),
      total: responseData.total,
      limit: responseData.limit,
      page: responseData.page,
    };
  },

  async getFinishedItems(libraryId: string): Promise<LibraryItem[]> {
    const libraryIdToUse = requireLibraryId(libraryId, "libraryItemsApi.getFinishedItems");

    const response = await absClient.get<{ results: LibraryItem[] }>(
      `/api/libraries/${libraryIdToUse}/items?filter=progress.ZmluaXNoZWQ=`,
    );

    return response.results;
  },

  async getFavorites(libraryId: string, favoriteTag?: string): Promise<LibraryItem[]> {
    const libraryIdToUse = requireLibraryId(libraryId, "libraryItemsApi.getFavorites");

    const favoriteSearchString =
      favoriteTag ?? favoritesApi.getUserFavoriteInfo().favoriteSearchString;

    const response = await absClient.get<{ results: LibraryItem[] }>(
      `/api/libraries/${libraryIdToUse}/items?filter=tags.${favoriteSearchString}`,
    );

    return response.results;
  },

  async getFavoritedAndFinishedItems(libraryId: string): Promise<FavoriteOrFinishedItem[]> {
    const libraryIdToUse = requireLibraryId(
      libraryId,
      "libraryItemsApi.getFavoritedAndFinishedItems",
    );

    const [finishedItems, favoriteItems] = await Promise.all([
      libraryItemsApi.getFinishedItems(libraryIdToUse),
      libraryItemsApi.getFavorites(libraryIdToUse),
    ]);

    const resultMap = new Map<string, FavoriteOrFinishedItem>();

    const mergeItem = (item: LibraryItem, type: "isFavorite" | "isRead") => {
      const coverUrls = buildCoverUrls(item.id);

      const existing = resultMap.get(item.id);
      if (existing) {
        existing.type = Array.from(new Set([...existing.type, type]));
      } else {
        resultMap.set(item.id, {
          itemId: item.id,
          title: item.media.metadata.title,
          author: item.media.metadata.authorName || "",
          imageURL: coverUrls.thumb,
          type: [type],
        });
      }
    };

    finishedItems.forEach((item) => mergeItem(item, "isRead"));
    favoriteItems.forEach((item) => mergeItem(item, "isFavorite"));

    return Array.from(resultMap.values()).filter((item) => item.itemId);
  },
};
