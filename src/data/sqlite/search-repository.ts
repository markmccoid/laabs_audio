import {
  getShadowItemSummariesByIds,
  queryShadowBookIndicators,
  queryShadowSearchResults,
  type ShadowBookIndicators,
  type ShadowSearchParams,
  type ShadowSearchResultSet,
} from "./search-reads";
import {
  getShadowLibraryReadiness,
  initializeShadowDatabase,
  type ShadowLibraryReadiness,
} from "./shadow-status";

export type SqliteSearchParams = ShadowSearchParams;
export type SqliteSearchResultSet = ShadowSearchResultSet;
export type SqliteBookIndicators = ShadowBookIndicators;
export type SqliteLibraryReadiness = ShadowLibraryReadiness;

export const sqliteSearchRepository = {
  initialize: initializeShadowDatabase,
  getReadiness: getShadowLibraryReadiness,
  querySearchResultSet: queryShadowSearchResults,
  getBookIndicators: queryShadowBookIndicators,
  getItemSummariesByIds: getShadowItemSummariesByIds,
};
