import {
  getShadowItemSummariesByIds,
  getShadowLibraryReadiness,
  initializeShadowDatabase,
  queryShadowSearchResults,
  type ShadowLibraryReadiness,
  type ShadowSearchParams,
  type ShadowSearchResult,
} from "../shadow-sqlite-service";

export type SqliteSearchParams = ShadowSearchParams;
export type SqliteSearchResult = Required<
  Pick<ShadowSearchResult, "itemById" | "resultIds" | "favoriteIds" | "finishedIds">
> &
  Omit<ShadowSearchResult, "itemById" | "resultIds" | "favoriteIds" | "finishedIds">;
export type SqliteLibraryReadiness = ShadowLibraryReadiness;

export const sqliteSearchRepository = {
  initialize: initializeShadowDatabase,
  getReadiness: getShadowLibraryReadiness,
  querySearchResultSet: queryShadowSearchResults,
  getItemSummariesByIds: getShadowItemSummariesByIds,
};
