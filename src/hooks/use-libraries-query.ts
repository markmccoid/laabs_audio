import { useQuery } from "@tanstack/react-query";
import { librariesApi } from "../api/libraries-api";
import { useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";

export const LIBRARIES_QUERY_KEY = queryKeys.libraries;

export const useLibrariesQuery = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);

  return useQuery({
    queryKey: LIBRARIES_QUERY_KEY(activeLibraryUserKey),
    queryFn: () => librariesApi.getAll(),
    enabled: status === "authenticated" && Boolean(activeLibraryUserKey),
    meta: { persist: true },
    retry: false,
  });
};
