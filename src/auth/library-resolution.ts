import { librariesApi, type LibrariesResponse } from "../api/libraries-api";
import { queryClient } from "../query/query-client";
import { queryKeys } from "../query/query-keys";
import type { Library } from "../types/absTypes";

export type LibraryResolutionResult =
  | { status: "noLibraries"; libraries: Library[] }
  | { status: "selectedActiveLibrary"; library: Library; libraries: Library[] }
  | { status: "needsLibrarySelection"; libraries: Library[] };

export const resolveLibrarySelection = (
  libraries: Library[],
  activeLibraryId?: string | null,
): LibraryResolutionResult => {
  if (libraries.length === 0) {
    return { status: "noLibraries", libraries };
  }

  const activeLibrary = activeLibraryId
    ? libraries.find((library) => library.id === activeLibraryId)
    : null;

  if (activeLibrary) {
    return {
      status: "selectedActiveLibrary",
      library: activeLibrary,
      libraries,
    };
  }

  if (libraries.length === 1) {
    return {
      status: "selectedActiveLibrary",
      library: libraries[0],
      libraries,
    };
  }

  return { status: "needsLibrarySelection", libraries };
};

export const fetchLibrariesForResolution = () =>
  queryClient.fetchQuery<LibrariesResponse>({
    queryKey: queryKeys.libraries,
    queryFn: () => librariesApi.getAll(),
    meta: { persist: true },
    staleTime: 0,
  });
