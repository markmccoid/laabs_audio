import type { QueryClient } from "@tanstack/react-query";
import { mmkvQueryPersister } from "../store/mmkv-query-persister";

const SESSION_QUERY_ROOTS = new Set<unknown>([
  "libraries",
  "library",
  "user",
  "itemDetails",
  "series",
  // Legacy pre-refactor roots.
  "books",
  "absfilterdata",
]);

const isSessionQuery = (query: { queryKey?: readonly unknown[] }) => {
  const root = Array.isArray(query.queryKey) ? query.queryKey[0] : undefined;
  return SESSION_QUERY_ROOTS.has(root);
};

export const clearSessionQueryCache = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({
    predicate: isSessionQuery,
  });
  queryClient.removeQueries({
    predicate: isSessionQuery,
  });
  mmkvQueryPersister.removeClient?.();
};
