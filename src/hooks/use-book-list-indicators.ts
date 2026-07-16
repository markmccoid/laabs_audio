import { useAuthStore } from "@/auth/auth-store";
import { sqliteSearchRepository } from "@/data/sqlite/search-repository";
import { queryKeys } from "@/query/query-keys";
import { useQuery } from "@tanstack/react-query";

const EMPTY_ID_SET = new Set<string>();

export const useBookListIndicators = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const query = useQuery({
    queryKey: queryKeys.sqliteBookIndicators(activeLibraryUserKey, activeLibraryId),
    queryFn: () => sqliteSearchRepository.getBookIndicators(),
    enabled:
      status === "authenticated" && Boolean(activeLibraryUserKey) && Boolean(activeLibraryId),
  });

  return {
    favoriteIds: query.data?.favoriteIds ?? EMPTY_ID_SET,
    finishedIds: query.data?.finishedIds ?? EMPTY_ID_SET,
  };
};
