import { useEffect } from "react";
import { useAuthStore } from "@/auth/auth-store";
import { queryClient } from "@/query/query-client";
import { isPodcastLibraryMediaType } from "@/podcast/series-index-readiness";
import { resolveActiveLibraryMediaType } from "@/podcast/resolve-active-library-media-type";
import { sqliteRefreshCoordinator } from "./refresh-coordinator";
import { sqliteSearchRepository } from "./search-repository";

export const useSqliteActiveLibraryRefresh = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryMediaType = useAuthStore((state) => state.activeLibraryMediaType);

  useEffect(() => {
    void sqliteSearchRepository.initialize().catch((error) => {
      console.warn("[sqlite] initialization failed", error);
    });
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !activeLibraryUserKey || !activeLibraryId) return;

    const mediaType = resolveActiveLibraryMediaType(activeLibraryId, activeLibraryMediaType);

    // Podcast Active Libraries use the Podcast Series Index path — never book full-catalog ingest.
    if (isPodcastLibraryMediaType(mediaType)) {
      return;
    }

    void sqliteRefreshCoordinator
      .refreshActiveLibrary(
        { userId: activeLibraryUserKey, libraryId: activeLibraryId },
        { queryClient },
      )
      .catch((error) => {
        console.warn("[sqlite] active library refresh failed", error);
      });
  }, [activeLibraryId, activeLibraryMediaType, activeLibraryUserKey, status]);
};
