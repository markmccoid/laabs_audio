import { authStore } from "../auth/auth-store";
import type { GetLibraryItemsResponse, LibraryItem } from "../types/absTypes";
import { absClient } from "./abs-client";
import { buildCoverUrls } from "./cover-urls";
import { favoritesApi } from "./favorites-api";

export type FilterType = "genres" | "tags" | "authors" | "series" | "progress";

export type GetLibraryItemsParams = {
  libraryId?: string;
  filterType?: FilterType;
  filterValue?: string;
  sortBy?: string;
  page?: number;
  limit?: number;
};

export type LibraryItemSummary = {
  id: string;
  title: string;
  subtitle?: string | undefined | null;
  author?: string | undefined | null;
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
  isFinished: boolean;
  isFavorite: boolean;
};

export type LibraryItemsSummary = LibraryItemSummary[];

export type FavoriteOrFinishedItem = {
  itemId: string;
  title: string;
  author: string;
  imageURL: string;
  type: Array<"isFavorite" | "isRead">;
};

const resolveLibraryId = (libraryId?: string | null) =>
  libraryId ?? authStore.getState().activeLibraryId;

export const libraryItemsApi = {
  async getItems(params: GetLibraryItemsParams = {}): Promise<LibraryItemsSummary> {
    const { filterType, filterValue, sortBy, page, limit } = params;
    const libraryId = resolveLibraryId(params.libraryId);

    if (!libraryId || typeof libraryId !== "string" || libraryId.trim() === "") {
      console.warn("getItems: No active library set");
      return [];
    }

    const { favoriteSearchString } = favoritesApi.getUserFavoriteInfo();
    const query = new URLSearchParams();

    if (filterType && filterValue) {
      query.set("filter", `${filterType}.${filterValue}`);
    }

    if (sortBy) {
      query.set("sort", sortBy);
    }

    if (typeof page === "number") {
      query.set("page", String(page));
    }

    if (typeof limit === "number") {
      query.set("limit", String(limit));
    }

    const suffix = query.toString();
    const url = `/api/libraries/${libraryId}/items${suffix ? `?${suffix}` : ""}`;
    const finishedUrl = `/api/libraries/${libraryId}/items?filter=progress.ZmluaXNoZWQ=`;
    const favoriteUrl = `/api/libraries/${libraryId}/items?filter=tags.${favoriteSearchString}`;

    const responseData = await absClient.get<GetLibraryItemsResponse>(url);

    const [finishedResult, favoriteResult] = await Promise.allSettled([
      absClient.get<{ results: LibraryItem[] }>(finishedUrl),
      absClient.get<{ results: LibraryItem[] }>(favoriteUrl),
    ]);

    const finishedItemIds =
      finishedResult.status === "fulfilled"
        ? finishedResult.value.results.map((item) => item.id)
        : [];

    const favoriteItemIds =
      favoriteResult.status === "fulfilled"
        ? favoriteResult.value.results.map((item) => item.id)
        : [];

    const finishedItemIdSet = new Set(finishedItemIds);
    const favoriteItemIdSet = new Set(favoriteItemIds);

    const token = authStore.getState().accessToken;
    if (!token) return [];

    return responseData.results.map((item) => {
      const coverUrls = buildCoverUrls(item.id, { token });

      return {
        id: item.id,
        title: item.media.metadata.title,
        subtitle: item.media.metadata.subtitle,
        author: item.media.metadata.authorName,
        series: item.media.metadata.seriesName,
        publishedDate: item.media.metadata.publishedDate,
        publishedYear: item.media.metadata.publishedYear,
        narratedBy: item.media.metadata.narratorName,
        description: item.media.metadata.description,
        duration: item.media.duration,
        addedAt: item.addedAt,
        updatedAt: item.updatedAt,
        cover: coverUrls.coverThumbWithToken,
        coverFull: coverUrls.coverFullWithToken,
        numAudioFiles: item.media.numAudioFiles,
        ebookFormat: item.media?.ebookFormat,
        genres: item.media.metadata.genres,
        tags: item.media.tags,
        asin: item.media.metadata.asin,
        isFinished: finishedItemIdSet.has(item.id),
        isFavorite: favoriteItemIdSet.has(item.id),
        // _searchCore: `${item.media.metadata.title.toLowerCase()} ${item.media.metadata.subtitle?.toLowerCase()} ${item.media.metadata.authorName?.toLowerCase()}`,
        // _searchDesc: item.media.metadata.description.toLowerCase(), // Only used if toggle is on
      };
    });
  },

  async getFinishedItems(libraryId?: string): Promise<LibraryItem[]> {
    const libraryIdToUse = resolveLibraryId(libraryId);

    if (!libraryIdToUse) {
      return [];
    }

    const response = await absClient.get<{ results: LibraryItem[] }>(
      `/api/libraries/${libraryIdToUse}/items?filter=progress.ZmluaXNoZWQ=`,
    );

    return response.results;
  },

  async getFavorites(libraryId?: string, favoriteTag?: string): Promise<LibraryItem[]> {
    const libraryIdToUse = resolveLibraryId(libraryId);

    if (!libraryIdToUse) {
      return [];
    }

    const favoriteSearchString =
      favoriteTag ?? favoritesApi.getUserFavoriteInfo().favoriteSearchString;

    const response = await absClient.get<{ results: LibraryItem[] }>(
      `/api/libraries/${libraryIdToUse}/items?filter=tags.${favoriteSearchString}`,
    );

    return response.results;
  },

  async getFavoritedAndFinishedItems(libraryId?: string): Promise<FavoriteOrFinishedItem[]> {
    const libraryIdToUse = resolveLibraryId(libraryId);

    if (!libraryIdToUse) {
      console.warn("getFavoritedAndFinishedItems: No active library set");
      return [];
    }

    const [finishedItems, favoriteItems] = await Promise.all([
      libraryItemsApi.getFinishedItems(libraryIdToUse),
      libraryItemsApi.getFavorites(libraryIdToUse),
    ]);

    const token = authStore.getState().accessToken;
    if (!token) {
      throw new Error("No ABS token found");
    }

    const resultMap = new Map<string, FavoriteOrFinishedItem>();

    const mergeItem = (item: LibraryItem, type: "isFavorite" | "isRead") => {
      const coverUrls = buildCoverUrls(item.id, { token });

      const existing = resultMap.get(item.id);
      if (existing) {
        existing.type = Array.from(new Set([...existing.type, type]));
      } else {
        resultMap.set(item.id, {
          itemId: item.id,
          title: item.media.metadata.title,
          author: item.media.metadata.authorName || "",
          imageURL: coverUrls.coverThumbWithToken,
          type: [type],
        });
      }
    };

    finishedItems.forEach((item) => mergeItem(item, "isRead"));
    favoriteItems.forEach((item) => mergeItem(item, "isFavorite"));

    return Array.from(resultMap.values()).filter((item) => item.itemId);
  },
};
