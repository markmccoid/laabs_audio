import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { SeriesSummary } from "@/data/sqlite/series-repository";
import { sqliteSeriesRepository } from "@/data/sqlite/series-repository";
import { useLibrarySeries } from "../use-library-series";

const mockAuthState = {
  status: "authenticated",
  activeLibraryId: "library-1",
  activeLibraryUserKey: "user-1",
  isOnline: true,
};

jest.mock("@/auth/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

jest.mock("@/data/sqlite/series-repository", () => ({
  sqliteSeriesRepository: {
    getSeries: jest.fn(),
    getSeriesBookIdsBySeriesIds: jest.fn(),
    refreshSeries: jest.fn(),
  },
}));

const cachedSeries: SeriesSummary[] = [
  {
    id: "series-1",
    libraryId: "library-1",
    name: "Cached Series",
    bookCount: 2,
    createdAt: 10,
    totalDuration: 20,
  },
];

const flushQueryUpdates = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useLibrarySeries", () => {
  it("publishes cached SQLite Series while the network refresh remains pending", async () => {
    let resolveRefresh: ((value: { status: "completed" }) => void) | undefined;
    const pendingRefresh = new Promise<{ status: "completed" }>((resolve) => {
      resolveRefresh = resolve;
    });
    jest.mocked(sqliteSeriesRepository.getSeries).mockResolvedValue(cachedSeries);
    jest.mocked(sqliteSeriesRepository.getSeriesBookIdsBySeriesIds).mockResolvedValue({
      "series-1": ["book-1", "book-2"],
    });
    jest.mocked(sqliteSeriesRepository.refreshSeries).mockReturnValue(pendingRefresh as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    let latestResult: ReturnType<typeof useLibrarySeries> | null = null;
    let renderer: ReactTestRenderer | null = null;
    const Probe = () => {
      latestResult = useLibrarySeries();
      return null;
    };

    await act(async () => {
      renderer = create(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe),
        ),
      );
    });
    await act(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await flushQueryUpdates();
        if (jest.mocked(sqliteSeriesRepository.refreshSeries).mock.calls.length > 0) break;
      }
    });

    expect(sqliteSeriesRepository.refreshSeries).toHaveBeenCalled();
    expect(latestResult?.series).toEqual(cachedSeries);
    expect(latestResult?.isLoading).toBe(false);

    resolveRefresh?.({ status: "completed" });
    await act(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await flushQueryUpdates();
      }
      renderer?.unmount();
    });
    queryClient.clear();
  });
});
