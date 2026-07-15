import { playlistsApi } from "@/api/playlists-api";
import { useAuthStore } from "@/auth/auth-store";
import { queryKeys } from "@/query/query-keys";
import { useQuery } from "@tanstack/react-query";

// Shared with Home so opening the Playlists segment normally reads the warmed
// query cache instead of issuing another request.
export const useLibraryPlaylists = () => {
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOnline = useAuthStore((state) => state.isOnline);

  return useQuery({
    queryKey: queryKeys.libraryPlaylists(activeLibraryUserKey, activeLibraryId),
    queryFn: () => {
      if (!activeLibraryId) {
        throw new Error("useLibraryPlaylists requires an active library");
      }
      return playlistsApi.getLibraryPlaylists(activeLibraryId);
    },
    enabled:
      status === "authenticated" &&
      Boolean(activeLibraryId) &&
      Boolean(activeLibraryUserKey) &&
      isOnline !== false,
    meta: { persist: true },
  });
};
