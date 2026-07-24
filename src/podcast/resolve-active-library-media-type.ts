import { authStore } from "@/auth/auth-store";
import { queryClient } from "@/query/query-client";
import { queryKeys } from "@/query/query-keys";
import type { Library } from "@/types/absTypes";

type LibrariesQueryData = {
  libraries?: Library[];
};

/**
 * Resolve Active Library mediaType without React Query hooks so headless
 * surfaces (CarPlay) can call this outside QueryClientProvider.
 */
export const resolveActiveLibraryMediaType = (
  libraryId: string | null | undefined,
  mediaTypeFromAuth?: string | null,
): string | null => {
  const fromAuth = mediaTypeFromAuth?.trim() || null;
  if (fromAuth) return fromAuth;
  if (!libraryId) return null;

  const userKey = authStore.getState().activeLibraryUserKey;
  const cached = queryClient.getQueryData<LibrariesQueryData>(queryKeys.libraries(userKey));
  return cached?.libraries?.find((library) => library.id === libraryId)?.mediaType ?? null;
};
