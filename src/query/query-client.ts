import { QueryClient } from "@tanstack/react-query";

export const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: FIVE_MINUTES_MS,
      gcTime: Infinity,
    },
  },
});
