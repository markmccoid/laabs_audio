import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LibrarySelectionGate } from "../library-selection-gate";

const mockClearActiveLibrary = jest.fn();
const mockRefetch = jest.fn();
const mockSelectLibrary = jest.fn();

const mockAuthState = {
  status: "authenticated",
  loginRequired: false,
  storedUserId: "user-1",
  activeLibraryId: "library-1",
  activeLibraryName: "Books",
};

const mockLibrarySelection = {
  libraries: [],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isError: true,
  refetch: mockRefetch,
  selectLibrary: mockSelectLibrary,
};

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useSegments: () => ["(tabs)", "(home)"],
}));

jest.mock("../../auth/auth-store", () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
  useAuthActions: () => ({ clearActiveLibrary: mockClearActiveLibrary }),
}));

jest.mock("../../auth/use-explicit-logout", () => ({
  useExplicitLogout: () => jest.fn(),
}));

jest.mock("../../auth/library-activation-store", () => ({
  useLibraryActivationStore: (selector: (state: { status: "idle" }) => unknown) =>
    selector({ status: "idle" }),
}));

jest.mock("../../hooks/use-activate-library-selection", () => ({
  useActivateLibrarySelection: () => jest.fn(),
}));

jest.mock("../../hooks/use-library-selection", () => ({
  useLibrarySelection: () => mockLibrarySelection,
}));

describe("LibrarySelectionGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps the remembered Active Library when ABS is unreachable", async () => {
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(React.createElement(LibrarySelectionGate));
    });

    expect(mockClearActiveLibrary).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });
});
