import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  clearAssistantOpenInFlight,
  peekAssistantOpenInFlight,
} from "./assistant-open-destination";
import { useAssistantOpenNavigation } from "./use-assistant-open-navigation";

let mockPending: { id: string; libraryItemId: string } | null = null;
let mockSegments = ["(tabs)", "(home)"];
let mockParams: { libraryItemId?: string } = {};
let mockReady = true;
const mockPush = jest.fn();
let mockUrlListener: ((event: { url: string }) => void) | null = null;
let mockWriteOnSubscribe = false;
const mockListeners = new Map<string, () => void>();
const mockAcknowledge = jest.fn((id: string) => {
  if (mockPending?.id !== id) return false;
  mockPending = null;
  return true;
});

jest.mock("@/native/assistant", () => ({
  AssistantBridgeModule: {
    peekPendingOpen: () => mockPending?.libraryItemId ?? null,
    takePendingOpen: jest.fn(),
    peekPendingOpenRequest: () => mockPending,
    acknowledgePendingOpen: (id: string) => mockAcknowledge(id),
    addListener: (name: string, listener: () => void) => {
      mockListeners.set(name, listener);
      if (mockWriteOnSubscribe) {
        mockWriteOnSubscribe = false;
        mockPending = { id: "startup-race", libraryItemId: "book-1" };
      }
      return { remove: () => mockListeners.delete(name) };
    },
  },
}));
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useSegments: () => mockSegments,
  useGlobalSearchParams: () => mockParams,
  useRootNavigationState: () => (mockReady ? { key: "root" } : undefined),
}));
jest.mock("expo-linking", () => ({
  addEventListener: (
    _name: string,
    listener: (event: { url: string }) => void,
  ) => {
    mockUrlListener = listener;
    return {
      remove: () => {
        mockUrlListener = null;
      },
    };
  },
  parse: () => ({}),
}));
jest.mock("react-native", () => ({
  AppState: {
    addEventListener: (_name: string, listener: (state: string) => void) => {
      mockListeners.set("active", () => listener("active"));
      return { remove: () => mockListeners.delete("active") };
    },
  },
}));

function Harness({ canNavigate = true }: { canNavigate?: boolean }) {
  useAssistantOpenNavigation({ canNavigate });
  return null;
}

describe("Assistant Open delivery", () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockListeners.clear();
    mockPending = null;
    mockWriteOnSubscribe = false;
    mockSegments = ["(tabs)", "(home)"];
    mockParams = {};
    mockReady = true;
    clearAssistantOpenInFlight();
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    jest.useRealTimers();
    clearAssistantOpenInFlight();
  });
  const mount = (canNavigate = true) => {
    act(() => {
      renderer = create(React.createElement(Harness, { canNavigate }));
    });
  };
  const receive = (id: string, libraryItemId: string) => {
    act(() => {
      mockPending = { id, libraryItemId };
      mockListeners.get("onAssistantOpen")?.();
    });
  };
  const showBook = (libraryItemId: string) => {
    mockSegments = ["(tabs)", "(home)", "[libraryItemId]"];
    mockParams = { libraryItemId };
    act(() => renderer.update(React.createElement(Harness)));
  };

  it("delivers a destination arriving long after foreground without another activation", () => {
    mount();
    act(() => jest.advanceTimersByTime(5000));
    receive("request-1", "book-1");
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ params: { libraryItemId: "book-1" } }),
    );
    expect(mockPending?.id).toBe("request-1");
    expect(mockAcknowledge).not.toHaveBeenCalled();
    showBook("book-1");
    expect(mockAcknowledge).toHaveBeenCalledWith("request-1");
    expect(mockPending).toBeNull();
    expect(peekAssistantOpenInFlight()).toBeNull();
  });

  it("does not duplicate navigation when both native Open and its book URL arrive", () => {
    mount();
    receive("first", "book-1");
    act(() => mockUrlListener?.({ url: "laabsaudio:///book-1" }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPending?.id).toBe("first");
    showBook("book-1");
    expect(mockPending).toBeNull();
  });

  it("opens ordinary book URLs and clears their startup hold when the route appears", () => {
    mount();
    act(() => mockUrlListener?.({ url: "laabsaudio:///book-1" }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(peekAssistantOpenInFlight()).toBe("book-1");
    showBook("book-1");
    expect(peekAssistantOpenInFlight()).toBeNull();
  });

  it("recovers a write made while installing the native listener", () => {
    mockWriteOnSubscribe = true;
    mount();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPending?.id).toBe("startup-race");
  });

  it("does not push again for duplicate notifications before route confirmation", () => {
    mount();
    receive("first", "book-1");
    act(() => mockListeners.get("onAssistantOpen")?.());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPending?.id).toBe("first");
  });

  it("delivers a second request after the previous book was acknowledged", () => {
    mount();
    receive("first", "book-1");
    showBook("book-1");
    receive("second", "book-2");
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPending?.id).toBe("second");
    showBook("book-2");
    expect(mockPending).toBeNull();
  });

  it("does not replay completed requests when returning from the background", () => {
    mount();
    receive("first", "book-1");
    showBook("book-1");
    mockSegments = ["(tabs)", "(home)"];
    mockParams = {};
    act(() => renderer.update(React.createElement(Harness)));
    act(() => mockListeners.get("active")?.());
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("keeps a cold-launch request until the navigator and authentication gate are ready", () => {
    mockPending = { id: "cold", libraryItemId: "book-1" };
    mockReady = false;
    mount(false);
    expect(mockPush).not.toHaveBeenCalled();
    mockReady = true;
    act(() =>
      renderer.update(React.createElement(Harness, { canNavigate: false })),
    );
    expect(mockPush).not.toHaveBeenCalled();
    act(() => renderer.update(React.createElement(Harness)));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPending?.id).toBe("cold");
  });

  it("does not acknowledge a newer request when an older book route becomes visible", () => {
    mount();
    receive("first", "book-1");
    receive("second", "book-2");
    showBook("book-1");
    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(mockPending?.id).toBe("second");
    showBook("book-2");
    expect(mockAcknowledge).toHaveBeenCalledWith("second");
  });

  it("retries an unconfirmed navigation on foreground, without consuming it early", () => {
    mount();
    receive("first", "book-1");
    act(() => mockListeners.get("active")?.());
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPending?.id).toBe("first");
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges a new request for the already visible book without pushing twice", () => {
    mount();
    receive("first", "book-1");
    showBook("book-1");
    receive("second", "book-1");
    expect(mockAcknowledge).toHaveBeenLastCalledWith("second");
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
