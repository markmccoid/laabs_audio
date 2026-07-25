import { useEffect } from "react";
import { useActiveLibraryExperience } from "@/auth/active-library-experience";
import { useAuthStore } from "@/auth/auth-store";
import { queryClient } from "@/query/query-client";
import { sqliteRefreshCoordinator } from "./refresh-coordinator";
import { sqliteSearchRepository } from "./search-repository";

export const useSqliteActiveLibraryRefresh = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const experience = useActiveLibraryExperience();

  useEffect(() => {
    void sqliteSearchRepository.initialize().catch((error) => {
      console.warn("[sqlite] initialization failed", error);
    });
  }, []);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      experience !== "book" ||
      !activeLibraryUserKey ||
      !activeLibraryId
    ) {
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
  }, [activeLibraryId, activeLibraryUserKey, experience, status]);
};
