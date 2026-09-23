import {
  ASSISTANT_SEARCH_QUERY_MAX_LENGTH,
  parseAssistantPendingSearch,
  resolveAssistantSearchDelivery,
  shouldTakeAssistantSearch,
  type AssistantSearchDelivery,
} from "./assistant-search-destination";

const pending = {
  query: " Stephen King ",
  userId: " user-1 ",
  libraryId: " lib-1 ",
};

const session = {
  currentUserId: "user-1",
  activeLibraryId: "lib-1",
  isAuthenticated: true,
};

describe("assistant search destination", () => {
  it("navigates when the pending search matches the session and open library", () => {
    const delivery = resolveAssistantSearchDelivery({ pending, ...session });

    expect(delivery).toEqual({
      kind: "navigate",
      search: { query: "Stephen King", userId: "user-1", libraryId: "lib-1" },
    });
    expect(shouldTakeAssistantSearch(delivery)).toBe(true);
  });

  it("waits without consuming the search until a user and library exist", () => {
    const noUser = resolveAssistantSearchDelivery({ pending, ...session, currentUserId: null });
    const noLibrary = resolveAssistantSearchDelivery({
      pending,
      ...session,
      activeLibraryId: "  ",
    });

    expect(noUser.kind).toBe("wait");
    expect(noLibrary.kind).toBe("wait");
    expect(shouldTakeAssistantSearch(noUser)).toBe(false);
    expect(shouldTakeAssistantSearch(noLibrary)).toBe(false);
  });

  it("discards and consumes a search for a different account", () => {
    const delivery = resolveAssistantSearchDelivery({
      pending,
      ...session,
      currentUserId: "user-2",
    });

    expect(delivery.kind).toBe("discard");
    expect(shouldTakeAssistantSearch(delivery)).toBe(true);
  });

  it("discards and consumes a search for a different library", () => {
    const delivery = resolveAssistantSearchDelivery({
      pending,
      ...session,
      activeLibraryId: "lib-2",
    });

    expect(delivery.kind).toBe("discard");
    expect(shouldTakeAssistantSearch(delivery)).toBe(true);
  });

  it("discards when the session is not authenticated", () => {
    const delivery = resolveAssistantSearchDelivery({
      pending,
      ...session,
      isAuthenticated: false,
    });

    expect(delivery.kind).toBe("discard");
    expect(shouldTakeAssistantSearch(delivery)).toBe(true);
  });

  it("does not deliver twice after the pending value is taken", () => {
    const first = resolveAssistantSearchDelivery({ pending, ...session });
    const second = resolveAssistantSearchDelivery({ pending: null, ...session });

    expect(first.kind).toBe("navigate");
    expect(second.kind).toBe("none");
    expect(shouldTakeAssistantSearch(second)).toBe(false);
  });

  it("rejects empty, oversized, incomplete, and NUL-containing searches", () => {
    expect(parseAssistantPendingSearch({ ...pending, query: "   " })).toBeNull();
    expect(
      parseAssistantPendingSearch({
        ...pending,
        query: "a".repeat(ASSISTANT_SEARCH_QUERY_MAX_LENGTH + 1),
      }),
    ).toBeNull();
    expect(parseAssistantPendingSearch({ query: "Dune", userId: "user-1" })).toBeNull();
    expect(parseAssistantPendingSearch({ query: "Dune", libraryId: "lib-1" })).toBeNull();
    expect(parseAssistantPendingSearch({ ...pending, query: "Du\u0000ne" })).toBeNull();
    expect(parseAssistantPendingSearch("Dune")).toBeNull();
    expect(
      parseAssistantPendingSearch({
        ...pending,
        query: "a".repeat(ASSISTANT_SEARCH_QUERY_MAX_LENGTH),
      }),
    ).not.toBeNull();
  });

  it("covers every delivery kind for take decisions", () => {
    const cases: AssistantSearchDelivery[] = [
      { kind: "none" },
      { kind: "wait" },
      { kind: "discard" },
      {
        kind: "navigate",
        search: { query: "Dune", userId: "user-1", libraryId: "lib-1" },
      },
    ];

    expect(cases.map((delivery) => shouldTakeAssistantSearch(delivery))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});
