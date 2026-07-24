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
  minified?: boolean;
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

export type PodcastSeriesIndexSummary = {
  id: string;
  title: string;
  author?: string | null;
  cover: string;
  coverFull: string;
  numEpisodes?: number | null;
  addedAt: number;
  updatedAt: number;
  podcastType?: string | null;
};

export type PodcastSeriesIndexPage = {
  results: PodcastSeriesIndexSummary[];
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
    const coverUrls = buildCoverUrls(item.id, { version: item.updatedAt });

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

  toPodcastSeriesSummary(item: LibraryItem): PodcastSeriesIndexSummary {
    const coverUrls = buildCoverUrls(item.id, { version: item.updatedAt });
    const metadata = item.media?.metadata;
    return {
      id: item.id,
      title: metadata?.title ?? "Untitled",
      author: metadata?.author ?? metadata?.authorName ?? null,
      cover: coverUrls.thumb,
      coverFull: coverUrls.full,
      numEpisodes: item.media?.numEpisodes ?? null,
      addedAt: item.addedAt ?? 0,
      updatedAt: item.updatedAt ?? 0,
      podcastType: metadata?.type ?? null,
    };
  },

  async getItemsPage(params: GetLibraryItemsParams): Promise<LibraryItemsSummaryPage> {
    const { filterType, filterValue, sortBy, page, limit, minified } = params;
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

    if (minified) {
      query.set("minified", "1");
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

  async getPodcastSeriesIndexPage(params: {
    libraryId: string;
    page?: number;
    limit?: number;
  }): Promise<PodcastSeriesIndexPage> {
    const libraryId = requireLibraryId(params.libraryId, "libraryItemsApi.getPodcastSeriesIndexPage");
    const query = new URLSearchParams();
    query.set("minified", "1");
    if (typeof params.page === "number") query.set("page", String(params.page));
    if (typeof params.limit === "number") query.set("limit", String(params.limit));
    query.set("sort", "addedAt");
    query.set("desc", "1");

    const responseData = await absClient.get<GetLibraryItemsResponse>(
      `/api/libraries/${libraryId}/items?${query.toString()}`,
    );

    return {
      results: responseData.results.map(libraryItemsApi.toPodcastSeriesSummary),
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

    // The tag filter is base64 and can contain '+', '/', '=' — left raw in a
    // query string some servers mangle them (e.g. '+' → space), silently
    // returning zero favorites for affected usernames.
    const response = await absClient.get<{ results: LibraryItem[] }>(
      `/api/libraries/${libraryIdToUse}/items?filter=tags.${encodeURIComponent(favoriteSearchString)}`,
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
      const coverUrls = buildCoverUrls(item.id, { version: item.updatedAt });

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
