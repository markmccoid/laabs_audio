import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/auth/auth-store", () => ({
  useAuthStore: (selector: (state: { activeLibraryId: string; activeLibraryUserKey: string }) => unknown) =>
    selector({ activeLibraryId: "library-1", activeLibraryUserKey: "user-1" }),
}));

jest.mock("@/query/query-keys", () => ({
  queryKeys: {
    sqliteItemSummaries: jest.fn(
      (_userKey: string, _libraryId: string, chunk: readonly string[]) => [
        "sqliteItemSummaries",
        chunk,
      ],
    ),
  },
}));

jest.mock("@tanstack/react-query", () => ({
  useQueries: jest.fn(({ combine, queries }) =>
    combine(queries.map(() => ({ data: new Map() }))),
  ),
}));

jest.mock("../search-repository", () => ({
  sqliteSearchRepository: { getItemSummariesByIds: jest.fn() },
}));

const { useWindowedItemSummaries } = jest.requireActual<
  typeof import("../use-windowed-item-summaries")
>("../use-windowed-item-summaries");

const FreshArrayProbe = () => {
  useWindowedItemSummaries([]);

  return null;
};

describe("useWindowedItemSummaries", () => {
  it("does not update state during render when result ids receive a fresh array identity", async () => {
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(React.createElement(FreshArrayProbe));
    });

    await act(async () => {
      renderer?.update(React.createElement(FreshArrayProbe));
    });

    await act(async () => {
      renderer?.unmount();
    });
  });
});
