import { mmkvStorage } from "@/store/mmkv-storage";
import { useListsPreferencesStore } from "../lists-preferences-store";

jest.mock("@/store/mmkv-storage", () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

describe("listsPreferencesStore", () => {
  beforeEach(() => {
    useListsPreferencesStore.setState({
      viewModeBySegment: {
        series: "list",
        collections: "list",
        playlists: "list",
      },
      seriesSortedBy: "name",
      seriesSortDirection: "asc",
    });
    jest.mocked(mmkvStorage.setItem).mockClear();
  });

  it("updates each segment view independently", () => {
    const { actions } = useListsPreferencesStore.getState();
    actions.setViewMode("collections", "grid");

    expect(useListsPreferencesStore.getState().viewModeBySegment).toEqual({
      series: "list",
      collections: "grid",
      playlists: "list",
    });
  });

  it("persists view and Series sort preferences without actions", () => {
    const { actions } = useListsPreferencesStore.getState();
    actions.setViewMode("playlists", "grid");
    actions.setSeriesSortBy("totalDuration");
    actions.setSeriesSortDirection("desc");

    const calls = jest.mocked(mmkvStorage.setItem).mock.calls;
    const persistedValue = JSON.parse(String(calls.at(-1)?.[1])) as {
      state: Record<string, unknown>;
    };

    expect(calls.at(-1)?.[0]).toBe("lists-preferences-storage");
    expect(persistedValue.state).toEqual({
      viewModeBySegment: {
        series: "list",
        collections: "list",
        playlists: "grid",
      },
      seriesSortedBy: "totalDuration",
      seriesSortDirection: "desc",
    });
    expect(persistedValue.state).not.toHaveProperty("actions");
  });
});
