import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LibrarySelectionGate } from "../library-selection-gate";

const mockClearActiveLibrary = jest.fn();
const mockRefetch = jest.fn();
const mockSelectLibrary = jest.fn();
const mockActivateLibrarySelection = jest.fn();

const mockAuthState = {
  status: "authenticated",
  loginRequired: false,
  storedUserId: "user-1",
  activeLibraryId: "library-1",
  activeLibraryName: "Books",
  activeLibraryMediaType: "book",
  activeLibraryReady: true,
};

const mockLibrarySelection = {
  libraries: [] as Array<{ id: string; name: string; mediaType: string }>,
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
  useActivateLibrarySelection: () => mockActivateLibrarySelection,
}));

jest.mock("../../hooks/use-library-selection", () => ({
  useLibrarySelection: () => mockLibrarySelection,
}));

describe("LibrarySelectionGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.activeLibraryId = "library-1";
    mockAuthState.activeLibraryName = "Books";
    mockAuthState.activeLibraryMediaType = "book";
    mockAuthState.activeLibraryReady = true;
    mockLibrarySelection.libraries = [];
    mockLibrarySelection.isError = true;
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

  it("activates a remembered same-ID podcast before treating it as ready", async () => {
    mockAuthState.activeLibraryName = "Podcasts";
    mockAuthState.activeLibraryMediaType = "podcast";
    mockAuthState.activeLibraryReady = false;
    mockLibrarySelection.isError = false;
    mockLibrarySelection.libraries = [
      { id: "library-1", name: "Podcasts", mediaType: "podcast" },
    ];

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(React.createElement(LibrarySelectionGate));
    });

    expect(mockActivateLibrarySelection).toHaveBeenCalledWith(
      mockLibrarySelection.libraries[0],
      { mode: "setup" },
    );
    expect(mockSelectLibrary).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });
});
