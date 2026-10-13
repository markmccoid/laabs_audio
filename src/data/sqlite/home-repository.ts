import {
  getShadowDiscoverCandidates,
  getShadowHomeProjection,
  getShadowOwnerProgressByIds,
  type ShadowHomeProjection,
  type ShadowHomeProjectionParams,
} from "./home-reads";

export type SqliteHomeProjectionParams = ShadowHomeProjectionParams;
export type SqliteHomeProjection = ShadowHomeProjection;

export const sqliteHomeRepository = {
  getDiscoverCandidates: getShadowDiscoverCandidates,
  getHomeProjection: getShadowHomeProjection,
  getOwnerProgressByIds: getShadowOwnerProgressByIds,
};
