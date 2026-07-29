import {
  getAuthenticatedRouteState,
  isKnownAuthenticatedRoute,
} from "../authenticated-route-state";

describe("authenticated route gate", () => {
  it("treats nested Episode Detail as known via tabs", () => {
    const routeState = getAuthenticatedRouteState(["(tabs)", "(home)", "episode-detail"]);

    expect(routeState.inTabs).toBe(true);
    expect(isKnownAuthenticatedRoute(routeState)).toBe(true);
  });

  it("does not treat an unknown root segment as authenticated", () => {
    const routeState = getAuthenticatedRouteState(["mystery-screen"]);

    expect(isKnownAuthenticatedRoute(routeState)).toBe(false);
  });

  it("still recognizes tabs and book utility sheets", () => {
    expect(isKnownAuthenticatedRoute(getAuthenticatedRouteState(["(tabs)"]))).toBe(true);
    expect(isKnownAuthenticatedRoute(getAuthenticatedRouteState(["book-downloads"]))).toBe(true);
  });

  it("treats Episode downloads sheet as a known authenticated root route", () => {
    const routeState = getAuthenticatedRouteState(["episode-downloads"]);

    expect(routeState.inEpisodeUtilitySheet).toBe(true);
    expect(isKnownAuthenticatedRoute(routeState)).toBe(true);
  });

  it.each([
    "episode-bookmarks",
    "episode-bookmark-detail",
    "episode-addbookmark",
  ])("treats %s as a known authenticated root route", (route) => {
    const routeState = getAuthenticatedRouteState([route]);

    expect(routeState.inEpisodeUtilitySheet).toBe(true);
    expect(isKnownAuthenticatedRoute(routeState)).toBe(true);
  });
});
