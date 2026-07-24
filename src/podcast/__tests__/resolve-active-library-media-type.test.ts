import { resolveActiveLibraryMediaType } from "../resolve-active-library-media-type";

jest.mock("@/auth/auth-store", () => ({
  authStore: {
    getState: jest.fn(() => ({ activeLibraryUserKey: "user-1" })),
  },
}));

jest.mock("@/query/query-client", () => ({
  queryClient: {
    getQueryData: jest.fn(),
  },
}));

import { queryClient } from "@/query/query-client";

const mockGetQueryData = queryClient.getQueryData as jest.Mock;

describe("resolveActiveLibraryMediaType", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prefers auth mediaType without reading QueryClient hooks", () => {
    expect(resolveActiveLibraryMediaType("lib-1", "podcast")).toBe("podcast");
    expect(mockGetQueryData).not.toHaveBeenCalled();
  });

  it("falls back to cached libraries list via singleton queryClient", () => {
    mockGetQueryData.mockReturnValue({
      libraries: [{ id: "lib-1", mediaType: "book" }],
    });
    expect(resolveActiveLibraryMediaType("lib-1", null)).toBe("book");
    expect(mockGetQueryData).toHaveBeenCalled();
  });
});
