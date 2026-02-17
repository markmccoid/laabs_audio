import { useCallback, useMemo } from "react";
import { useAuthActions, useAuthStore } from "../auth/auth-store";
import type { Library } from "../types/absTypes";
import { useLibrariesQuery } from "./use-libraries-query";

export const useLibrarySelection = () => {
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryName = useAuthStore((state) => state.activeLibraryName);
  const { setActiveLibrary } = useAuthActions();
  const query = useLibrariesQuery();
  const libraries = query.data?.libraries ?? [];

  const activeLibrary = useMemo(() => {
    return libraries.find((library) => library.id === activeLibraryId) ?? null;
  }, [activeLibraryId, libraries]);

  const selectLibrary = useCallback(
    (library: Library) => {
      setActiveLibrary({ id: library.id, name: library.name });
    },
    [setActiveLibrary],
  );

  return {
    libraries,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    activeLibrary,
    activeLibraryId,
    activeLibraryName,
    selectLibrary,
  };
};
