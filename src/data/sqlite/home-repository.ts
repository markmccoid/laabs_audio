import {
  getShadowDiscoverCandidates,
  getShadowHomeProjection,
  type ShadowHomeProjection,
  type ShadowHomeProjectionParams,
} from "../shadow-sqlite-service";

export type SqliteHomeProjectionParams = ShadowHomeProjectionParams;
export type SqliteHomeProjection = ShadowHomeProjection;

export const sqliteHomeRepository = {
  getDiscoverCandidates: getShadowDiscoverCandidates,
  getHomeProjection: getShadowHomeProjection,
};
