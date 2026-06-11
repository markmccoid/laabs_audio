import {
  getShadowItemSummariesByIds,
  getShadowLibraryReadiness,
  initializeShadowDatabase,
  queryShadowSearchResults,
  type ShadowLibraryReadiness,
  type ShadowSearchParams,
  type ShadowSearchResultSet,
} from "../shadow-sqlite-service";

export type SqliteSearchParams = ShadowSearchParams;
export type SqliteSearchResultSet = ShadowSearchResultSet;
export type SqliteLibraryReadiness = ShadowLibraryReadiness;

export const sqliteSearchRepository = {
  initialize: initializeShadowDatabase,
  getReadiness: getShadowLibraryReadiness,
  querySearchResultSet: queryShadowSearchResults,
  getItemSummariesByIds: getShadowItemSummariesByIds,
};
