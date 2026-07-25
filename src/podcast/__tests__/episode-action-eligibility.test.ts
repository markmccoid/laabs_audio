import {
  CURRENT_PODCAST_EPISODE_ACTIONS,
  HOME_EPISODE_ACTIONS,
  resolveEpisodeActionSet,
} from "../episode-action-eligibility";

describe("resolveEpisodeActionSet", () => {
  it("offers Play, Download, and Open Podcast on Home when no local download", () => {
    const actions = resolveEpisodeActionSet({
      actionIds: HOME_EPISODE_ACTIONS,
      hasPlayableLocalDownload: false,
      isOnCurrentPodcast: false,
      isEpisodePlaying: false,
    });

    expect(actions.map((action) => ({ id: action.id, visible: action.visible, label: action.label }))).toEqual([
      { id: "playPause", visible: true, label: "Play" },
      { id: "download", visible: true, label: "Download" },
      { id: "removeDownload", visible: false, label: "Remove Download" },
      { id: "openPodcast", visible: true, label: "Open Podcast" },
    ]);
  });

  it("offers Remove Download instead of Download when a playable local asset exists", () => {
    const actions = resolveEpisodeActionSet({
      actionIds: HOME_EPISODE_ACTIONS,
      hasPlayableLocalDownload: true,
      isOnCurrentPodcast: false,
      isEpisodePlaying: false,
    });

    expect(
      actions
        .filter((action) => action.visible)
        .map((action) => action.id),
    ).toEqual(["playPause", "removeDownload", "openPodcast"]);
  });

  it("omits Open Podcast on Current Podcast for the same Podcast", () => {
    const actions = resolveEpisodeActionSet({
      actionIds: CURRENT_PODCAST_EPISODE_ACTIONS,
      hasPlayableLocalDownload: false,
      isOnCurrentPodcast: true,
      isEpisodePlaying: false,
    });

    expect(
      actions
        .filter((action) => action.visible)
        .map((action) => action.id),
    ).toEqual(["playPause", "download"]);
  });

  it("labels Play/Pause as Pause when the Episode is playing", () => {
    const actions = resolveEpisodeActionSet({
      actionIds: HOME_EPISODE_ACTIONS,
      hasPlayableLocalDownload: false,
      isOnCurrentPodcast: false,
      isEpisodePlaying: true,
    });

    expect(actions.find((action) => action.id === "playPause")?.label).toBe("Pause");
  });
});
