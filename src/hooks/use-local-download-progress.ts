import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { UserBookProgress } from "../api/me-api";
import { useAuthStore } from "../auth/auth-store";
import { resolveListeningOwnerKey } from "../auth/listening-owner";
import { usePlaybackStore } from "../player/playback-store";
import { loadLocalDownloadProgress } from "../progress/local-download-progress-loader";
import { queryKeys } from "../query/query-keys";
import { useDeviceBooksStore } from "../store/device-books-store";

/**
 * Progress for owned downloads while no User Session is active. The SQLite home projection is
 * unavailable then, so each download's progress is rebuilt from its Downloaded Audio Asset Owner's
 * stored and native Listening Position. Returns undefined while signed in.
 */
export const useLocalDownloadProgress = (): Record<string, UserBookProgress> | undefined => {
  const authStatus = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const storedUserId = useAuthStore((state) => state.storedUserId);
  const playbackLibraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const downloadedDetailsById = useDeviceBooksStore((state) => state.downloadedDetailsById);
  const downloadedOwnerUserIdsById = useDeviceBooksStore(
    (state) => state.downloadedOwnerUserIdsById,
  );

  const owners = useMemo(
    () =>
      Object.keys(downloadedDetailsById)
        .filter((id) => (downloadedOwnerUserIdsById[id]?.length ?? 0) > 0)
        .sort()
        .map((libraryItemId) => ({
          libraryItemId,
          ownerId: resolveListeningOwnerKey(libraryItemId),
        })),
    // resolveListeningOwnerKey reads the auth identity and download owners from their stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeLibraryUserKey, downloadedDetailsById, downloadedOwnerUserIdsById, storedUserId],
  );

  const isSignedOut = authStatus !== "authenticated";
  const { data } = useQuery({
    queryKey: queryKeys.sqliteLocalDownloadProgress({ owners, playbackLibraryItemId }),
    queryFn: () =>
      loadLocalDownloadProgress(
        owners,
        Object.fromEntries(
          owners.map(({ libraryItemId }) => [
            libraryItemId,
            downloadedDetailsById[libraryItemId]?.media.duration ?? 0,
          ]),
        ),
      ),
    enabled: isSignedOut && owners.length > 0,
    placeholderData: (previousData) => previousData,
  });

  return isSignedOut ? data : undefined;
};
