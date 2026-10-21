import { authStore } from "../auth/auth-store";
import { playbackStore } from "../player/playback-store";
import audioWidget from "./LaabsAudioWidget";
import { startActiveAudiobookWidgetPublisher } from "./active-audiobook-widget-publisher";
import { omitNullWidgetProps } from "./widget-snapshot";
import {
  prepareWidgetArtwork,
  resolveCachedWidgetArtworkUri,
} from "./widget-artwork-cache";

const activeArtworkInput = () => {
  const playback = playbackStore.getState();
  const firstTrack = playback.queue[0];

  if (
    !playback.libraryItemId ||
    !firstTrack ||
    playback.episodeId ||
    !["ready", "playing", "paused"].includes(playback.playbackState)
  ) {
    return null;
  }

  return {
    sourceUri: firstTrack.artworkUri,
    libraryItemId: playback.libraryItemId,
  };
};

let stopActiveCoordinator: (() => void) | null = null;

// Idempotent: started once at bundle load, which can run without a window.
export const startActiveAudiobookWidgetCoordinator = () => {
  if (stopActiveCoordinator) return stopActiveCoordinator;

  const publisher = startActiveAudiobookWidgetPublisher({
    widget: {
      updateTimeline: (entries) =>
        audioWidget.updateTimeline(
          entries.map((entry) => ({ ...entry, props: omitNullWidgetProps(entry.props) })),
        ),
    },
    playback: playbackStore,
    auth: authStore,
    // WidgetKit renders every timeline entry ahead of time, so an hour of
    // per-minute entries took ~2.5 s to appear after a widget Play tap. While
    // audio plays the app stays alive and republishes each minute (reloads are
    // not budgeted during an active audio session), so one spare minute is enough.
    minuteCount: 1,
    resolveArtworkUri: ({ artworkUri, libraryItemId }) =>
      resolveCachedWidgetArtworkUri({
        sourceUri: artworkUri,
        libraryItemId,
      }),
  });

  let stopped = false;
  let artworkRequestKey: string | null = null;
  let artworkRequestGeneration = 0;

  const prepareArtwork = () => {
    const input = activeArtworkInput();
    if (!input) {
      artworkRequestKey = null;
      artworkRequestGeneration += 1;
      return;
    }

    const requestKey = JSON.stringify([
      input.libraryItemId,
      input.sourceUri ?? null,
    ]);

    if (requestKey === artworkRequestKey) return;
    artworkRequestKey = requestKey;
    const requestGeneration = ++artworkRequestGeneration;

    void prepareWidgetArtwork(input).then((artworkUri) => {
      if (
        stopped ||
        requestGeneration !== artworkRequestGeneration ||
        !artworkUri
      ) {
        return;
      }
      publisher.refresh();
    });
  };

  const unsubscribeArtwork = playbackStore.subscribe(prepareArtwork);
  prepareArtwork();

  stopActiveCoordinator = () => {
    stopped = true;
    artworkRequestGeneration += 1;
    unsubscribeArtwork();
    publisher.stop();
    stopActiveCoordinator = null;
  };
  return stopActiveCoordinator;
};
