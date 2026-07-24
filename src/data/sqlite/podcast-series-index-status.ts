import {
  getDb,
  initializeShadowDatabaseInternal,
} from "./shadow-db-core";
import type { PodcastSeriesIndexScope } from "@/podcast/podcast-library-experience";
import { requireAuthenticatedLibraryScope } from "./shadow-scope";

/**
 * A remembered Podcast Series Index exists when a prior refresh completed for
 * this User+Library — including an empty library (zero shows).
 */
export const hasRememberedPodcastSeriesIndex = async (
  scope: PodcastSeriesIndexScope,
): Promise<boolean> => {
  const context = requireAuthenticatedLibraryScope(scope);
  await initializeShadowDatabaseInternal();
  const db = await getDb();

  const libraryRow = await db.getFirstAsync<{ last_podcast_series_index_refresh_at: number | null }>(
    `SELECT last_podcast_series_index_refresh_at
     FROM libraries
     WHERE user_id = ? AND library_id = ?`,
    [context.userId, context.libraryId],
  );
  if (libraryRow?.last_podcast_series_index_refresh_at) {
    return true;
  }

  const completedRun = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM podcast_series_index_refresh_runs
     WHERE user_id = ? AND library_id = ? AND status = 'completed'
     LIMIT 1`,
    [context.userId, context.libraryId],
  );
  return Boolean(completedRun?.id);
};
