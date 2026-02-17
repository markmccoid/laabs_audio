import { sortBy } from "es-toolkit";
import {
  AuthorsItemsResponse,
  BookPersonalizedView,
  MediaProgress,
  PersonalizedViewsResponse,
  SeriesPersonalizedView,
} from "./abstypes";
// services/AudiobookshelfAPI.ts
import axios, { AxiosRequestConfig } from "axios";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Alert, Image } from "react-native";
// import { btoa } from "react-native-quick-base64";

import { kv } from "@store/mmkv/mmkv";
import { Keys } from "@store/mmkv/storageKeys";

import { Book } from "@/src/store/store-books";
import { PitchAlgorithm } from "react-native-track-player";
import { checkIsOnline, checkIsOnlineStrict } from "../networkHelper";
import { queryClient } from "../queryClient";
import { AudiobookshelfAuth } from "./absAuthClass";
import {
  ABSLoginResponse,
  AudiobookSession,
  AuthenticationError,
  Bookmark,
  FilterData,
  GetLibraryItemsResponse,
  ItemsInProgressResponse,
  Library,
  LibraryItem,
  NetworkError,
  OfflineError,
  User,
} from "./abstypes";
import { buildBookShelf, buildCoverURLSync } from "./absUtils";

// Types
export type FilterType = "genres" | "tags" | "authors" | "series" | "progress";

type GetLibraryItemsParams = {
  filterType?: FilterType;
  filterValue?: string;
  sortBy?: string;
  page?: number;
  limit?: number;
};

export type ABSGetLibraryItems = {
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
}[];
export type ABSGetLibraryItem = ABSGetLibraryItems[number];
export type ABSGetLibraries = Awaited<ReturnType<AudiobookshelfAPI["getLibraries"]>>;

// Items in progress type - based on actual return structure from getItemsInProgress
export type ABSGetItemsInProgress = {
  bookId: string;
  progressId: string | undefined;
  title: string;
  author: string;
  narrator: string;
  progressPercent?: number;
  duration?: number;
  currentTime?: number;
  hideFromContinueListening?: boolean;
  isFinished?: boolean;
  cover: string;
  coverFull: string;
  lastUpdate: number;
}[];
export type ABSGetItemInProgress = ABSGetItemsInProgress[number];

//# -----==================================================
//! LOOK INTO using the api/me endpoints for pulling and updating
//! user info like bookmarks, progress, listening sessions, etc
//# -----==================================================
export class AudiobookshelfAPI {
  private activeLibraryId: string | undefined;
  private auth!: AudiobookshelfAuth;
  constructor() {}

  //## -------------------------------------
  //## create
  //## -------------------------------------
  static async create() {
    const api = new AudiobookshelfAPI();
    api.auth = await AudiobookshelfAuth.create();
    // Try to restore from storage
    const defaultLibId = kv.getString(Keys.absDefaultLibraryId) || undefined;
    if (defaultLibId && defaultLibId.trim() !== "") {
      api.setActiveLibraryId(defaultLibId);
      return api;
    }

    // If we don't know reachability yet, avoid blocking initialization
    // and let the app proceed with cached/local data.
    const isOnline = await checkIsOnlineStrict();
    if (!isOnline) {
      console.warn("ABS create: Offline or unknown reachability, skipping library fetch");
      return api;
    }

    // Fallback: fetch libraries and set the first as active
    const libs = await api.getLibraries(); // note: this calls setActiveLibraryId internally
    // If no libraries, then we are not logged in and just return the api.
    return api;
  }
  //## -------------------------------------
  //## makeAuthenticatedRequest
  //## -------------------------------------
  private async makeAuthenticatedRequest<T>(
    endpoint: string,
    options: AxiosRequestConfig = {},
  ): Promise<T> {
    // Fail fast if offline
    const isOnline = await checkIsOnline();
    if (!isOnline) {
      throw new OfflineError("Cannot make request while offline");
    }

    const auth = await AudiobookshelfAuth.create();
    const accessToken = await auth.getValidAccessToken();
    const serverUrl = await auth.getStoredServerUrl();

    if (!accessToken || !serverUrl) {
      throw new AuthenticationError("Please login to continue");
    }

    const url = `${serverUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    try {
      const response = await axios({ url, headers, ...options });

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        try {
          const newToken = await auth.refreshAccessToken();
          if (!newToken) {
            throw new AuthenticationError("Session expired. Please login again.");
          }

          const retryResponse = await axios({
            url,
            headers: { ...headers, Authorization: `Bearer ${newToken}` },
            ...options,
          });

          return retryResponse.data;
        } catch {
          throw new AuthenticationError("Session expired. Please login again.");
        }
      }

      const statusText = error.response?.statusText || "Unknown error";
      const statusCode = error.response?.status || "Unknown status";
      throw new NetworkError(`Request failed: ${statusText} (${statusCode})`);
    }
  }
  // ## ===============================================================
  // ## Session and Streaming
  // ## ===============================================================
  //## -------------------------------------
  //## getPlayInfo - itemId is the Library Item Id
  //## -------------------------------------
  async getPlayInfo(itemId: string) {
    const response: AudiobookSession = await this.makeAuthenticatedRequest(
      `/api/items/${itemId}/play`,
      {
        method: "POST",
        data: {
          deviceInfo: {
            clientVersion: "1.0.0",
          },
          supportedMimeTypes: ["audio/flac", "audio/mpeg", "audio/mp4"],
          forceDirectPlay: false,
          forceTranscode: false,
        },
      },
    );
    return response;
    // const token = await this.auth.getValidAccessToken();
    // const addObj = this.buildTrackPlayerTracks(response, token);
    // return { addObj, response };
  }

  //## -------------------------------------
  //## closeSession
  //## -------------------------------------
  async closeSession(
    sessionId: string,
    data: { timeListened: number; currentTime: number; duration?: number },
  ) {
    await this.makeAuthenticatedRequest(`/api/session/${sessionId}/close`, {
      method: "POST",
      data,
    });
  }

  //## -------------------------------------
  //## syncProgressToServer
  //## -------------------------------------
  async syncProgressToServer(
    sessionId: string,
    syncData: { timeListened: number; currentTime: number },
  ): Promise<{ success: boolean; currentTime: number }> {
    try {
      await this.makeAuthenticatedRequest(`/api/session/${sessionId}/sync`, {
        method: "POST",
        data: syncData,
      });
      // Server only returns 200 OK, no progress data
      // Return the position we sent as confirmation
      return { success: true, currentTime: syncData.currentTime };
    } catch (error: any) {
      // ✅ Handle 404 errors more gracefully (session was already closed)
      if (error.statusCode === 404) {
        console.warn(`Session ${sessionId} was already closed. Skipping sync.`);
        return { success: false, currentTime: syncData.currentTime };
      }
      console.error("Failed to sync progress:", error);
      throw error; // Re-throw other errors
    }
  }
  // ## ===============================================================
  // ## Session and Streaming ----- END
  // ## ===============================================================

  //## -------------------------------------
  //## getLibraries
  //## -------------------------------------
  async getLibraries() {
    const response = await this.makeAuthenticatedRequest<any>("/api/libraries");
    // Check if an active library set, if not, set the first one as active

    const activeLibId = !this.getActiveLibraryId()
      ? response.libraries[0].id
      : this.getActiveLibraryId();
    // Also set the class variable for the activeLibrary.
    this.setActiveLibraryId(activeLibId);

    return (response.libraries as Library[]).map((lib) => ({
      id: lib.id,
      name: lib.name,
      displayOrder: lib.displayOrder,
      active: activeLibId === lib.id,
    }));
  }

  //## -------------------------------------
  //## setActiveLibraryId
  //## -------------------------------------
  public setActiveLibraryId(libraryId: string): void {
    if (libraryId && libraryId.trim() === "") {
      throw new Error("Library ID cannot be an empty string");
    }
    this.activeLibraryId = libraryId;
    // Store in MKV store
    kv.setString(Keys.absDefaultLibraryId, libraryId || "");
    //Invalidate the all get queries.
    queryClient.invalidateQueries();
  }

  //## -------------------------------------
  //## getActiveLibraryId
  //## -------------------------------------
  public getActiveLibraryId(): string | undefined {
    return this.activeLibraryId;
  }

  //## -------------------------------------
  //## saveBookmark
  //## -------------------------------------
  async saveBookmark(libraryItemId: string, bookmark: Bookmark) {
    const { time, title } = bookmark;
    const data = { time, title };
    return this.makeAuthenticatedRequest(`/api/me/item/${libraryItemId}/bookmark`, {
      method: "POST",
      data: JSON.stringify(data),
    });
  }

  //## -------------------------------------
  //## deleteBookmark
  //## -------------------------------------
  async deleteBookmark(itemId: string, positionSeconds: number) {
    return this.makeAuthenticatedRequest(`/api/me/item/${itemId}/bookmark/${positionSeconds}`, {
      method: "DELETE",
    });
  }

  //## -------------------------------------
  //## updateBookProgress
  //## -------------------------------------
  async updateBookProgress(itemId: string, currentTime: number) {
    return this.makeAuthenticatedRequest(`/api/me/progress/${itemId}`, {
      method: "PATCH",
      data: JSON.stringify({ currentTime }),
    });
  }

  //## -------------------------------------
  //## getBookProgress
  //## -------------------------------------
  async getBookProgress(itemId: string) {
    let resp;
    try {
      resp = await this.makeAuthenticatedRequest(`/api/me/progress/${itemId}`);
    } catch (e) {
    }

    return resp as MediaProgress;
  }

  //## -------------------------------------
  //## setBookFinished
  //## -------------------------------------
  async setBookFinished(itemId: string, isFinished: boolean) {
    return this.makeAuthenticatedRequest(`/api/me/progress/${itemId}`, {
      method: "PATCH",
      data: JSON.stringify({ isFinished }),
    });
  }

  //## -------------------------------------
  //## setFavoriteTag
  //## -------------------------------------
  async setFavoriteTag(itemId: string, tags: string[]) {
    return this.makeAuthenticatedRequest(`/api/items/${itemId}/media`, {
      method: "PATCH",
      data: JSON.stringify({ tags }),
    });
  }

  //## -------------------------------------
  //## getMe
  //## -------------------------------------
  async getMe() {
    return this.makeAuthenticatedRequest("/api/me") as Promise<User>;
  }

  //## -------------------------------------
  //## getUserInfo
  //## -------------------------------------
  async getUserInfo(): Promise<ABSLoginResponse["user"]> {
    const resp: ABSLoginResponse = await this.makeAuthenticatedRequest("/api/authorize", {
      method: "POST",
    });
    return resp.user;
  }

  //## -------------------------------------
  //## buildCoverURL
  //## -------------------------------------
  buildCoverURL(itemId: string, format: "webp" | "jpeg" = "webp") {
    // const auth = await AudiobookshelfAuth.create();
    // const token = await this.auth.getValidAccessToken();
    const serverUrl = this.auth.absURL;
    const coverThumb = `${serverUrl}/api/items/${itemId}/cover?format=${format}&width=240`;
    const coverFull = `${serverUrl}/api/items/${itemId}/cover?format=${format}`;
    return { coverThumb, coverFull };
  }
  async buildCoverURLAsync(itemId: string, format: "webp" | "jpeg" = "webp") {
    // const auth = await AudiobookshelfAuth.create();
    const token = await this.auth.getValidAccessToken();
    const serverUrl = this.auth.absURL;
    const coverThumb = `${serverUrl}/api/items/${itemId}/cover?format=${format}&width=240&token=${token}`;
    const coverFull = `${serverUrl}/api/items/${itemId}/cover?format=${format}&token=${token}`;
    return { coverThumb, coverFull };
  }

  // //## -------------------------------------
  // //## buildCoverURLSync
  // //## -------------------------------------
  // buildCoverURLSync(itemId: string, token: string, serverUrl: string, format: "webp" | "jpeg" = "webp") {
  //   // const auth = await AudiobookshelfAuth.create();
  //   // const serverUrl = this.auth.absURL;
  //   const coverThumb = `${serverUrl}/api/items/${itemId}/cover?format=${format}&width=240&token=${token}`;
  //   const coverFull = `${serverUrl}/api/items/${itemId}/cover?format=${format}&token=${token}`;
  //   return { coverThumb, coverFull };
  // }

  //## -------------------------------------
  //## getFavoritedAndFinishedItems
  //## -------------------------------------
  async getFavoritedAndFinishedItems() {
    const userFavoriteInfo = await this.getUserFavoriteInfo();
    const activeLibraryId = this.getActiveLibraryId();

    // If no active library, return empty array to prevent 404 errors
    if (!activeLibraryId) {
      console.warn("getFavoritedAndFinishedItems: No active library set");
      return [];
    }

    const progressurl = `/api/libraries/${activeLibraryId}/items?filter=progress.ZmluaXNoZWQ=`;
    const favoriteurl = `/api/libraries/${activeLibraryId}/items?filter=tags.${userFavoriteInfo.favoriteSearchString}`;

    let progressData, favData;
    try {
      progressData = (await this.makeAuthenticatedRequest(progressurl)) as {
        results: LibraryItem[];
      };
      favData = (await this.makeAuthenticatedRequest(favoriteurl)) as { results: LibraryItem[] };
    } catch (error) {
    }

    interface ItemInfo {
      itemId: string;
      type: "isFavorite" | "isRead";
      title: string;
      author: string;
      imageURL: string;
    }
    type ItemInfoMerged = Pick<ItemInfo, "itemId" | "title" | "author" | "imageURL"> & {
      type: ("isFavorite" | "isRead")[];
    };
    const token = await this.auth.getValidAccessToken();

    if (!token) throw new Error("No ABS Token found");

    const readResults: ItemInfo[] =
      (await Promise.all(
        progressData?.results?.map((el: LibraryItem) => {
          const coverURL = buildCoverURLSync(el.id, token, this.auth.absURL);
          // this is the base64 Image
          // const coverURI = (await getCoverURI(coverURL)).coverURL;
          return {
            itemId: el.id,
            type: "isRead",
            title: el.media.metadata.title,
            author: el.media.metadata.authorName || "",
            imageURL: coverURL.coverThumb,
          };
        }) ?? [],
      )) || [];

    const favResults: ItemInfo[] =
      (await Promise.all(
        favData?.results?.map(async (el: LibraryItem) => {
          const coverURL = buildCoverURLSync(el.id, token, this.auth.absURL);
          // const coverURL = this.buildCoverURLSync(el.id, token);
          // const coverURI = (await getCoverURI(coverURL)).coverURL;
          return {
            itemId: el.id,
            type: "isFavorite",
            title: el.media.metadata.title || "",
            author: el.media.metadata.authorName || "",
            imageURL: coverURL.coverThumb,
          };
        }) ?? [],
      )) || [];

    // Create a function that you can pass an "ItemInfo" object into and it will
    // add to the result map so that we get a new ItemInfo object, but with the type being an array
    // with one or both of the "isFavorite" or "isRead"

    const resultMap = new Map();
    const mergeItems = (item: ItemInfo) => {
      if (resultMap.has(item.itemId)) {
        const existingItem = resultMap.get(item.itemId);
        existingItem.type = [...new Set([...existingItem.type, item.type])];
      } else {
        resultMap.set(item.itemId, { ...item, type: [item.type] });
      }
    };

    favResults.forEach(mergeItems);
    readResults.forEach(mergeItems);

    return Array.from(resultMap.values()).filter((el) => el.itemId) as ItemInfoMerged[];
  }

  //## -------------------------------------
  //## getItemDetails
  //## -------------------------------------
  async getItemDetails(itemId?: string) {
    let libraryItem: LibraryItem;
    try {
      const response = await this.makeAuthenticatedRequest(
        `/api/items/${itemId}?expanded=1&include=progress`,
      );
      libraryItem = response as LibraryItem;
    } catch (error) {
      throw error;
    }

    const coverURL = this.buildCoverURL(libraryItem.id);
    // The coverURI used to be used so that I could hash a cover so
    // it always showed the same placeholder cover. Now I use expo-image and
    // its placeholder property and it is always the same image.
    // const coverURI = (await getCoverURI(coverURL)).coverURL;

    const authorId = libraryItem.media.metadata?.authors[0].id;
    let authorBookCount = 0;
    try {
      const authorBookCountResp = (await this.makeAuthenticatedRequest(
        `/api/authors/${authorId}?include=items`,
      )) as AuthorsItemsResponse;
      authorBookCount = authorBookCountResp.libraryItems.length;
    } catch (error) {
      throw error;
    }

    if (!libraryItem?.media?.audioFiles) {
      throw new Error("No Media or Audiofiles");
    }

    let bookDuration = 0;
    for (const audio of libraryItem.media.audioFiles) {
      bookDuration += audio.duration;
    }

    return {
      id: libraryItem.id,
      audioFiles: libraryItem.media.audioFiles,
      media: libraryItem.media,
      bookDuration: libraryItem.media.duration,
      userMediaProgress: libraryItem?.userMediaProgress,
      coverURI: coverURL.coverFull,
      authorBookCount,
      updatedAt: libraryItem.updatedAt,
      libraryFiles: libraryItem.libraryFiles,
    };
  }

  //## -------------------------------------
  //## absDownloadItem
  //## -------------------------------------
  async absDownloadItem(itemId: string, fileIno: string) {
    const auth = await AudiobookshelfAuth.create();
    const token = await auth.getValidAccessToken();
    const serverUrl = await auth.getStoredServerUrl();

    const authHeader = { Authorization: `Bearer ${token}` };
    const url = `${serverUrl}/api/items/${itemId}/file/${fileIno}/download`;
    const urlWithToken = `${url}?token=${token}`;

    return { url, urlWithToken, authHeader, libraryItemId: itemId };
  }

  //## -------------------------------------
  //## downloadEbook
  //## -------------------------------------
  async downloadEbook(itemId: string, fileIno: string, filenameWExt: string) {
    let tempFileUri: string | null = null;
    const { url, authHeader } = await this.absDownloadItem(itemId, fileIno);

    try {
      if (!FileSystem.cacheDirectory) {
        throw new Error("Cache directory not available on this platform");
      }
      const tempDir = `${FileSystem.cacheDirectory}temp_downloads/`;
      await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
      tempFileUri = `${tempDir}${filenameWExt}`;

      const downloadResult = await FileSystem.downloadAsync(url, tempFileUri, {
        headers: authHeader,
      });

      if (downloadResult.status === 200) {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(downloadResult.uri);
        } else {
          Alert.alert("Download Complete", `File downloaded successfully`);
        }
      } else {
        throw new Error(`Download failed with status: ${downloadResult.status}`);
      }
    } catch (error) {
      console.error("Download error:", error);
      Alert.alert("Download Failed", "Unable to download the file. Please try again.");
    } finally {
      if (tempFileUri) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(tempFileUri);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(tempFileUri);
          }
        } catch (cleanupError) {
          console.warn("Failed to clean up temporary file:", cleanupError);
        }
      }
    }
  }

  //## -------------------------------------
  //## getLibraryFilterData
  //## -------------------------------------
  async getLibraryFilterData(libraryId?: string) {
    // Validate and sanitize libraryId parameter
    let libraryIdToUse = libraryId || this.getActiveLibraryId();

    // Handle case where libraryId might be an object (e.g., [object Object])
    if (typeof libraryIdToUse === "object") {
      console.warn("getLibraryFilterData: libraryId is an object, converting to string");
      libraryIdToUse = undefined; // Treat objects as invalid
    }

    // If still no library ID, throw appropriate error
    if (!libraryIdToUse || typeof libraryIdToUse !== "string" || libraryIdToUse.trim() === "") {
      console.warn("getLibraryFilterData: No library ID provided and no active library set");
      throw new Error("No library ID available for filter data request");
    }

    let response;
    try {
      response = await this.makeAuthenticatedRequest(`/api/libraries/${libraryIdToUse}/filterdata`);
    } catch (error) {
      throw new Error(`absGetLibraryFilterData - ${error}`);
    }

    const libararyData = response as FilterData;
    const genres = libararyData.genres.map((genre) => ({
      name: genre,
      b64Encoded: btoa(genre),
    }));
    const tags = libararyData.tags.map((tag) => ({
      name: tag,
      b64Encoded: btoa(tag),
    }));
    const authors = libararyData.authors.map((author) => ({
      ...author,
      base64encoded: btoa(author.id),
    }));
    const series = libararyData.series.map((series) => ({
      ...series,
      base64encoded: btoa(series.id),
    }));

    return { id: libraryId, genres, tags, authors, series };
  }

  //## -------------------------------------
  //##  getLibraryItems
  //## -------------------------------------
  async getLibraryItems({
    filterType = undefined,
    filterValue = undefined,
    sortBy = undefined,
  }: GetLibraryItemsParams = {}): Promise<ABSGetLibraryItems> {
    // Always use the active library ID
    const libraryId = this.getActiveLibraryId();

    // If no active library ID, return empty array to prevent 404 errors
    if (!libraryId || typeof libraryId !== "string" || libraryId.trim() === "") {
      console.warn("getLibraryItems: No active library set");
      return [];
    }

    const userFavoriteInfo = await this.getUserFavoriteInfo();
    let queryParams = "";

    if (filterType) {
      queryParams = `?filter=${filterType}.${filterValue}`;
    }
    if (sortBy) {
      queryParams = `${queryParams}${queryParams ? "&" : "?"}sort=${sortBy}`;
    }

    const url = `/api/libraries/${libraryId}/items${queryParams}`;
    const progressurl = `/api/libraries/${libraryId}/items?filter=progress.ZmluaXNoZWQ=`;
    const favoriteurl = `/api/libraries/${libraryId}/items?filter=tags.${userFavoriteInfo.favoriteSearchString}`;
    let responseData, progressresponseData, favresponseData;
    try {
      responseData = (await this.makeAuthenticatedRequest(url)) as GetLibraryItemsResponse;
    } catch (error) {
      throw error;
    }

    try {
      progressresponseData = (await this.makeAuthenticatedRequest(progressurl)) as {
        results: LibraryItem[];
      };
      favresponseData = (await this.makeAuthenticatedRequest(favoriteurl)) as {
        results: LibraryItem[];
      };
    } catch (error) {
    }

    const libraryItems = responseData?.results as GetLibraryItemsResponse["results"];
    const finishedItemIds = progressresponseData?.results?.map((el) => el.id);
    const favoritedItemIds = favresponseData?.results?.map((el) => el.id);

    const finishedItemIdSet = new Set(finishedItemIds);
    const favoritedItemIdSet = new Set(favoritedItemIds);

    const token = await this.auth.getValidAccessToken();
    // If not token, should probably throw error.
    if (!token) return [];
    const booksMin = libraryItems.map((item) => {
      const coverURL = buildCoverURLSync(item.id, token, this.auth.absURL);

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
        cover: coverURL.coverThumb,
        coverFull: coverURL.coverFull,
        numAudioFiles: item.media.numAudioFiles,
        ebookFormat: item.media?.ebookFormat,
        genres: item.media.metadata.genres,
        tags: item.media.tags,
        asin: item.media.metadata.asin,
        isFinished: finishedItemIdSet.has(item.id),
        isFavorite: favoritedItemIdSet.has(item.id),
      };
    });

    return booksMin;
  }

  //## -------------------------------------
  //##  Book Shelves
  //## -------------------------------------
  async getBookShelves() {
    const activeLibraryId = this.getActiveLibraryId();

    // If no active library, return null to prevent 404 errors
    if (!activeLibraryId) {
      console.warn("getBookShelves: No active library set");
      return null;
    }

    const personalizedURL = `/api/libraries/${activeLibraryId}/personalized?limit=16`;
    let resp: PersonalizedViewsResponse;

    try {
      resp = await this.makeAuthenticatedRequest(personalizedURL);
    } catch (e) {
      return null;
    }

    //~ Continue Listening Shelf
    const continueListeningShelf = resp.find(
      (el): el is BookPersonalizedView => el.id === "continue-listening",
    );
    if (!continueListeningShelf) return;
    const continueListening = buildBookShelf<BookPersonalizedView>(continueListeningShelf);

    //~ Recently Added Shelf
    const recentlyAddedShelf = resp.find(
      (el): el is BookPersonalizedView => el.id === "recently-added",
    );
    if (!recentlyAddedShelf) return;
    const recentlyAdded = buildBookShelf<BookPersonalizedView>(recentlyAddedShelf);

    //~ Discover Shelf
    const discoverShelf = resp.find((el): el is BookPersonalizedView => el.id === "discover");
    if (!discoverShelf) return;
    const discover = buildBookShelf<BookPersonalizedView>(discoverShelf);

    //~ Listen Again Shelf
    const listenAgainShelf = resp.find(
      (el): el is BookPersonalizedView => el.id === "listen-again",
    );
    if (!listenAgainShelf) return;
    const listenAgain = buildBookShelf<BookPersonalizedView>(listenAgainShelf);

    const recentSeries = resp.find((el): el is SeriesPersonalizedView => el.id === "recent-series");

    type Shelf = {
      books: Pick<Book, "libraryItemId">[];
      shelfId: string;
      shelfLabel: string;
    };

    // Use shelf IDs as keys directly (e.g., "continue-listening", "recently-added", etc.)
    const shelves: Record<string, Shelf> = {
      ...(continueListening ? { "continue-listening": continueListening } : {}),
      ...(recentlyAdded ? { "recently-added": recentlyAdded } : {}),
      ...(discover ? { discover } : {}),
      ...(listenAgain ? { "listen-again": listenAgain } : {}),
    };

    // return { continueListening, recentSeries, recentlyAdded, discover, listenAgain } ;
    return { ...shelves };
  }

  //## -------------------------------------
  //##  getItemsInProgress
  //## -------------------------------------
  async getItemsInProgress(): Promise<ABSGetItemsInProgress> {
    const progressURL = `/api/me/items-in-progress`;
    const activeLibraryId = this.getActiveLibraryId();

    // If no active library, return empty array to prevent 404 errors
    if (!activeLibraryId) {
      console.warn("getItemsInProgress: No active library set");
      return [];
    }

    const finishedURL = `/api/libraries/${activeLibraryId}/items?filter=progress.ZmluaXNoZWQ=`;
    let progressData, userData, finishedData;

    try {
      // ✅ Get user data with specific error handling
      userData = await this.getMe();
    } catch (error) {
      throw error;
    }

    try {
      // ✅ Get items in progress with specific error handling
      progressData = (await this.makeAuthenticatedRequest(progressURL)) as ItemsInProgressResponse;
    } catch (error) {
      throw error;
    }
    try {
      finishedData = (await this.makeAuthenticatedRequest(finishedURL)) as GetLibraryItemsResponse;
    } catch (error) {
      throw error;
    }
    // User data which includes mediaProgress.  But only ids for libraryItems.  Need to join with
    // items-in-progress API route to get book detail
    const mediaProgress = userData.mediaProgress;
    const continueListeningBooks = progressData.libraryItems;
    const finishedBooks = finishedData.results;

    let itemsInProgress: ABSGetItemsInProgress = [];

    const token = await this.auth.getValidAccessToken();
    if (!token) return [];

    for (let mediaMatch of mediaProgress) {
      // const mediaMatch = mediaProgress.find((el) => el.libraryItemId === book.id);
      let book = continueListeningBooks.find((el) => el.id === mediaMatch?.libraryItemId);
      if (!book) {
        book = finishedBooks.find((el) => el.id === mediaMatch?.libraryItemId);
      }
      // Don't think this should ever get triggered
      if (!book) continue;

      const coverURL = buildCoverURLSync(book.id, token, this.auth.absURL);

      if (book.libraryId !== this.activeLibraryId) continue;
      //!! NEED TO CHECK TO SEE WHY ISFINISHED BOOKS STILL SHOWING
      itemsInProgress.push({
        progressId: mediaMatch?.id,
        bookId: book.id,
        title: book.media.metadata.title,
        author: book.media.metadata.authorName || "",
        narrator: book.media.metadata.narratorName || "",
        progressPercent: mediaMatch?.progress,
        duration: mediaMatch?.duration,
        currentTime: mediaMatch?.currentTime,
        isFinished: mediaMatch?.isFinished,
        hideFromContinueListening: mediaMatch?.hideFromContinueListening,
        cover: coverURL.coverThumb,
        coverFull: coverURL.coverFull,
        lastUpdate: mediaMatch?.lastUpdate || 0,
      });
    }

    // Keep sorted in last time position was updated in descending order
    return sortBy(itemsInProgress, ["lastUpdate"]).reverse();
  }

  //## -------------------------------------
  //## hideFromContinueListening
  //## -------------------------------------
  async hideFromContinueListening(progressId: string) {
    if (!progressId) return undefined;
    const url = `/api/me/progress/${progressId}/remove-from-continue-listening`;
    let userResults: User | undefined;
    try {
      userResults = await this.makeAuthenticatedRequest(url);
      queryClient.invalidateQueries({ queryKey: ["booksInProgress", this.activeLibraryId] });
    } catch (e) {
    }
    return userResults;
  }

  //## -------------------------------------
  //## getUserFavoriteInfo
  //## -------------------------------------
  async getUserFavoriteInfo() {
    const auth = await AudiobookshelfAuth.create();
    const favoriteSearchString = btoa(`${auth.username}-laab-favorite`);
    const favoriteUserTagValue = `${auth.username}-laab-favorite`;
    return {
      favoriteSearchString,
      favoriteUserTagValue,
    };
  }

  //## -------------------------------------
  //## buildTrackPlayerTracks
  //## -------------------------------------
  buildTrackPlayerTracks(playbackData: AudiobookSession, token) {
    const { audioTracks, libraryItem, chapters } = playbackData;

    return audioTracks.map((track, index) => {
      // Choose streaming method based on what's available
      let streamUrl;

      if (track.contentUrl && track.mimeType === "application/vnd.apple.mpegurl") {
        // HLS streaming (preferred for larger files)
        streamUrl = `${this.auth.absURL}${track.contentUrl}`;
      } else {
        // Fallback to direct file streaming
        const directTrack = libraryItem.media.tracks[index];
        // streamUrl = `${this.auth.absURL}${directTrack.contentUrl}?token=${token}`;
        streamUrl = `${this.auth.absURL}/public/session/${playbackData.id}/track/1`;
      }

      return {
        id: `${libraryItem.id}-${index}`,
        url: streamUrl,
        title: track.title || libraryItem.media.metadata.title,
        artist: libraryItem.media.metadata.authors?.map((a) => a.name).join(", ") || "Unknown",
        artwork: `${this.auth.absURL}/api/items/${libraryItem.id}/cover?token=${token}`,
        duration: track.duration,
        // AudioBookshelf specific metadata
        libraryItemId: libraryItem.id,
        sessionId: playbackData.id, // Important for session tracking
        trackIndex: index,
        startOffset: track.startOffset,
        chapters: chapters || [],
        pitchAlgorithm: PitchAlgorithm.Voice,
        // Headers for authentication (for direct streams)
        headers:
          track.mimeType === "application/vnd.apple.mpegurl"
            ? {}
            : {
                Authorization: `Bearer ${token}`,
              },
      };
    })[0];
  }
}

// 🔹 Helpers
export const getImageSize = (uri: string) => {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
};

export const getCoverURI = async (
  coverURL: string,
): Promise<{ coverURL: string; type: "passthrough" | "localasset" }> => {
  try {
    await getImageSize(coverURL);
    return { coverURL, type: "passthrough" };
  } catch {
  }
  return { coverURL: "", type: "passthrough" };
};
