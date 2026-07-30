import { authStore } from "../auth/auth-store";
import { playbackStore } from "../player/playback-store";
import audioWidget from "./LaabsAudioWidget";
import { startActiveAudiobookWidgetPublisher } from "./active-audiobook-widget-publisher";
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

export const startActiveAudiobookWidgetCoordinator = () => {
  const publisher = startActiveAudiobookWidgetPublisher({
    widget: audioWidget,
    playback: playbackStore,
    auth: authStore,
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

  return () => {
    stopped = true;
    artworkRequestGeneration += 1;
    unsubscribeArtwork();
    publisher.stop();
  };
};
