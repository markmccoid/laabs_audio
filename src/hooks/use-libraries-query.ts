import { useQuery } from "@tanstack/react-query";
import { librariesApi } from "../api/libraries-api";
import { useAuthStore } from "../auth/auth-store";

export const LIBRARIES_QUERY_KEY = ["libraries"] as const;

export const useLibrariesQuery = () => {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: LIBRARIES_QUERY_KEY,
    queryFn: () => librariesApi.getAll(),
    enabled: status === "authenticated",
    staleTime: 60 * 1000,
    retry: false,
  });
};
