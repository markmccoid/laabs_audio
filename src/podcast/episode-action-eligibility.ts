/**
 * Episode Action Set eligibility (ADR 0031).
 * Pure projection — parallel to Book Action Sets; does not reuse BookActionId.
 */

export type EpisodeActionId =
  | "playPause"
  | "download"
  | "removeDownload"
  | "openPodcast";

export const HOME_EPISODE_ACTIONS = [
  "playPause",
  "download",
  "removeDownload",
  "openPodcast",
] as const satisfies readonly EpisodeActionId[];

export const CURRENT_PODCAST_EPISODE_ACTIONS = [
  "playPause",
  "download",
  "removeDownload",
  "openPodcast",
] as const satisfies readonly EpisodeActionId[];

export type EpisodeActionEligibility = {
  id: EpisodeActionId;
  visible: boolean;
  disabled: boolean;
  label: string;
};

export type ResolveEpisodeActionSetInput = {
  actionIds: readonly EpisodeActionId[];
  hasPlayableLocalDownload: boolean;
  /** True when already on Current Podcast for this Episode's parent Podcast. */
  isOnCurrentPodcast: boolean;
  isEpisodePlaying?: boolean;
};

const labelFor = (
  id: EpisodeActionId,
  isEpisodePlaying: boolean,
): string => {
  switch (id) {
    case "playPause":
      return isEpisodePlaying ? "Pause" : "Play";
    case "download":
      return "Download";
    case "removeDownload":
      return "Remove Download";
    case "openPodcast":
      return "Open Podcast";
  }
};

export const resolveEpisodeActionSet = (
  input: ResolveEpisodeActionSetInput,
): EpisodeActionEligibility[] => {
  const isEpisodePlaying = Boolean(input.isEpisodePlaying);

  return input.actionIds.map((id) => {
    const label = labelFor(id, isEpisodePlaying);
    switch (id) {
      case "playPause":
        return { id, visible: true, disabled: false, label };
      case "download":
        return {
          id,
          visible: !input.hasPlayableLocalDownload,
          disabled: false,
          label,
        };
      case "removeDownload":
        return {
          id,
          visible: input.hasPlayableLocalDownload,
          disabled: false,
          label,
        };
      case "openPodcast":
        return {
          id,
          visible: !input.isOnCurrentPodcast,
          disabled: false,
          label,
        };
    }
  });
};
