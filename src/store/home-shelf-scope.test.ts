import { authStore } from "@/auth/auth-store";
import {
  deviceBooksStore,
  LOCAL_HOME_SHELF_SCOPE_KEY,
  selectHomeShelfScopeKey,
} from "./device-books-store";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const signedIn = {
  status: "authenticated" as const,
  activeLibraryUserKey: "user-a",
  storedUserId: "user-a",
  activeLibraryId: "lib-1",
};

describe("selectHomeShelfScopeKey", () => {
  it("uses the user+library scope while signed in", () => {
    expect(selectHomeShelfScopeKey(signedIn)).toBe("user-a::lib-1");
  });

  it("has no scope while signed in without a library yet", () => {
    expect(selectHomeShelfScopeKey({ ...signedIn, activeLibraryId: null })).toBeNull();
  });

  it("keeps the user's scope when their session token was rejected", () => {
    expect(selectHomeShelfScopeKey({ ...signedIn, status: "offlineOnly" })).toBe("user-a::lib-1");
  });

  it("uses the signed-out scope after logout", () => {
    const loggedOut = {
      status: "offlineOnly" as const,
      activeLibraryUserKey: null,
      storedUserId: null,
      activeLibraryId: null,
    };
    expect(selectHomeShelfScopeKey(loggedOut)).toBe(LOCAL_HOME_SHELF_SCOPE_KEY);
    expect(selectHomeShelfScopeKey({ ...loggedOut, status: "anonymous" })).toBe(
      LOCAL_HOME_SHELF_SCOPE_KEY,
    );
  });

  it("has no scope while hydrating", () => {
    expect(
      selectHomeShelfScopeKey({
        status: "hydrating",
        activeLibraryUserKey: null,
        storedUserId: null,
        activeLibraryId: null,
      }),
    ).toBeNull();
  });
});

describe("custom shelves while signed out", () => {
  beforeEach(() => {
    deviceBooksStore.setState({ customShelvesByScope: {} });
  });

  it("creates and fills a shelf in the signed-out scope", () => {
    authStore.setState({
      status: "anonymous",
      activeLibraryUserKey: null,
      storedUserId: null,
      activeLibraryId: null,
    });
    const { actions } = deviceBooksStore.getState();
    const shelfId = actions.createCustomShelf("Bedtime", { userKey: null, libraryId: null });
    expect(shelfId).toBeTruthy();
    actions.addBookToCustomShelf(shelfId!, "imp_1", { userKey: null, libraryId: null });

    const shelves = deviceBooksStore.getState().customShelvesByScope[LOCAL_HOME_SHELF_SCOPE_KEY];
    expect(shelves).toHaveLength(1);
    expect(shelves?.[0]?.bookIds).toEqual(["imp_1"]);
  });

  it("does not show signed-out shelves to a signed-in user", () => {
    authStore.setState(signedIn);
    deviceBooksStore.getState().actions.createCustomShelf("Library shelf");
    const { customShelvesByScope } = deviceBooksStore.getState();
    expect(customShelvesByScope["user-a::lib-1"]).toHaveLength(1);
    expect(customShelvesByScope[LOCAL_HOME_SHELF_SCOPE_KEY]).toBeUndefined();
  });
});
