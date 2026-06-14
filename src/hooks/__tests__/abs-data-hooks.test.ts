/**
 * Unit tests for the selectItemDetailsResult helper in abs-data-hooks.
 *
 * Testing approach: no hook-testing library is installed in this project, so the
 * auth-state branching was extracted into the pure selectItemDetailsResult helper
 * and tested directly here. This covers the regression from plan 002 —
 * refetch being undefined in Downloaded-Only Mode.
 *
 * The module import chain for abs-data-hooks pulls in native modules
 * (react-native-mmkv via auth-store, items-api, etc.). We mock those entire
 * modules here so the pure helper can be imported without a simulator.
 */

// --- Block the native-module chain before any imports ---
jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  }),
  useMMKVString: jest.fn(),
}));

jest.mock("../../store/mmkv-storage", () => ({
  mmkvStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock("../../auth/auth-store", () => ({
  useAuthStore: jest.fn(),
  selectAccessMode: jest.fn(),
  useAuthActions: jest.fn(),
  authStore: { getState: jest.fn() },
}));

jest.mock("../../store/device-books-store", () => ({
  useDeviceBooksStore: jest.fn(),
  deviceBooksStore: { getState: jest.fn() },
  resolveStoredDownloadCoverUri: jest.fn(),
}));

jest.mock("../../store/downloaded-book-helpers", () => ({
  resolveBookCoverUri: jest.fn(),
  toDownloadedBookSummary: jest.fn(),
}));

jest.mock("../../api/items-api", () => ({
  itemsApi: { getItemDetails: jest.fn() },
}));

jest.mock("../../api/libraries-api", () => ({
  librariesApi: { getFilterData: jest.fn() },
}));

jest.mock("../../api/library-items-api", () => ({}));

jest.mock("../../api/me-api", () => ({
  meApi: {},
  createEmptyUserServerState: jest.fn(),
}));

jest.mock("../../api/series-api", () => ({
  seriesApi: { getSeries: jest.fn() },
}));

jest.mock("../../query/query-keys", () => ({
  queryKeys: {
    itemDetails: jest.fn(),
    sqliteItemSummaries: jest.fn(),
    libraryFilterData: jest.fn(),
    userServerState: jest.fn(),
    seriesWithProgress: jest.fn(),
    itemsInProgress: jest.fn(),
  },
}));

jest.mock("../../data/sqlite/search-repository", () => ({
  sqliteSearchRepository: { getItemSummariesByIds: jest.fn() },
}));

jest.mock("../../query/sqlite-invalidation", () => ({
  invalidateSqliteOverlayProjections: jest.fn(),
}));

jest.mock("../../data/sqlite/overlay-writes", () => ({
  upsertShadowServerProgressProjection: jest.fn(),
}));

jest.mock("../../query/user-server-state-reconcile", () => ({
  fetchReconciledUserServerState: jest.fn(),
}));

jest.mock("../../hooks/use-libraries-query", () => ({
  useLibrariesQuery: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

// --- Now import the pure helper under test ---
import { selectItemDetailsResult } from "../abs-data-hooks";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal stub of the React Query rest object that includes refetch */
const makeRest = () => ({
  refetch: jest.fn().mockResolvedValue(undefined),
  fetchStatus: "idle" as const,
  dataUpdatedAt: 0,
  errorUpdatedAt: 0,
  failureCount: 0,
  failureReason: null,
  isFetched: true,
  isFetchedAfterMount: false,
  isFetching: false,
  isInitialLoading: false,
  isLoadingError: false,
  isPlaceholderData: false,
  isRefetchError: false,
  isRefetching: false,
  isStale: false,
  isSuccess: true,
});

const mockData = {
  id: "book-1",
  title: "Test Book",
} as Parameters<typeof selectItemDetailsResult>[0]["downloadedFallback"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("selectItemDetailsResult", () => {
  describe("authenticated state", () => {
    it("returns the resolved data and a callable refetch", () => {
      const rest = makeRest();
      const result = selectItemDetailsResult({
        status: "authenticated",
        accessMode: "normal",
        downloadedFallback: mockData,
        rest,
        resolvedData: mockData,
        isPending: false,
        isError: false,
        isLoading: false,
        error: null,
      });

      expect(result.data).toBe(mockData);
      expect(typeof result.refetch).toBe("function");
      // Ensure it is the real refetch forwarded from rest
      expect(result.refetch).toBe(rest.refetch);
    });
  });

  describe("unauthenticated + downloadedOnly mode (regression: plan 002)", () => {
    it("returns downloadedFallback as data AND a callable refetch", () => {
      const rest = makeRest();
      const result = selectItemDetailsResult({
        status: "unauthenticated",
        accessMode: "downloadedOnly",
        downloadedFallback: mockData,
        rest,
        resolvedData: undefined,
        isPending: false,
        isError: false,
        isLoading: false,
        error: null,
      });

      expect(result.data).toBe(mockData);
      // This is the regression: previously refetch was undefined here
      expect(typeof result.refetch).toBe("function");
      expect(result.refetch).toBe(rest.refetch);
    });

    it("returns downloadedFallback for downloadedSessionOnly mode too", () => {
      const rest = makeRest();
      const result = selectItemDetailsResult({
        status: "unauthenticated",
        accessMode: "downloadedSessionOnly",
        downloadedFallback: mockData,
        rest,
        resolvedData: undefined,
        isPending: false,
        isError: false,
        isLoading: false,
        error: null,
      });

      expect(result.data).toBe(mockData);
      expect(typeof result.refetch).toBe("function");
    });
  });

  describe("unauthenticated + not downloaded (requires sign-in)", () => {
    it("returns undefined data AND a callable refetch", () => {
      const rest = makeRest();
      const result = selectItemDetailsResult({
        status: "unauthenticated",
        accessMode: "requiresSignIn",
        downloadedFallback: undefined,
        rest,
        resolvedData: undefined,
        isPending: false,
        isError: false,
        isLoading: false,
        error: null,
      });

      expect(result.data).toBeUndefined();
      // refetch must still be a callable function
      expect(typeof result.refetch).toBe("function");
      expect(result.refetch).toBe(rest.refetch);
    });
  });

  describe("explicit overrides are not clobbered by rest spread", () => {
    it("unauthenticated branch keeps explicit false/null values", () => {
      const rest = makeRest();
      const result = selectItemDetailsResult({
        status: "unauthenticated",
        accessMode: "downloadedOnly",
        downloadedFallback: mockData,
        rest,
        resolvedData: undefined,
        isPending: false,
        isError: false,
        isLoading: false,
        error: null,
      });

      expect(result.isPending).toBe(false);
      expect(result.isError).toBe(false);
      expect(result.isLoading).toBe(false);
      expect(result.error).toBeNull();
    });
  });
});
