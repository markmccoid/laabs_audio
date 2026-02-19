import { useQuery } from "@tanstack/react-query";
import { librariesApi } from "../api/libraries-api";
import { useAuthStore } from "../auth/auth-store";
import { queryKeys } from "../query/query-keys";

export const LIBRARIES_QUERY_KEY = queryKeys.libraries;

export const useLibrariesQuery = () => {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: LIBRARIES_QUERY_KEY,
    queryFn: () => librariesApi.getAll(),
    enabled: status === "authenticated",
    meta: { persist: true },
    retry: false,
  });
};
