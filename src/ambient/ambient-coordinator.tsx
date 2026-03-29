import { useEffect, useRef } from "react";
import { usePlaybackStore } from "@/player";
import { useAmbientStore } from "@/store/store-ambient";
import { ambientService } from "./ambient-service";

export const AmbientCoordinator = () => {
  const isEnabled = useAmbientStore((state) => state.isEnabled);
  const activeTrackId = useAmbientStore((state) => state.activeTrackId);
  const activeLibraryItemId = useAmbientStore((state) => state.activeLibraryItemId);
  const ambientPlaybackState = useAmbientStore((state) => state.playbackState);
  const libraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const queueLength = usePlaybackStore((state) => state.queue.length);
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const attachedTrackIdForLoadedBook = useAmbientStore((state) =>
    libraryItemId ? state.attachedTrackIdByLibraryItemId[libraryItemId] ?? null : null,
  );
  const hasLoadedBook = Boolean(libraryItemId) && queueLength > 0;
  const previousPlaybackState = useRef(playbackState);

  useEffect(() => {
    if (!isEnabled) {
      if (activeTrackId || activeLibraryItemId || ambientPlaybackState !== "idle") {
        ambientService.stopActiveTrack();
      }
      return;
    }

    if (!hasLoadedBook || !libraryItemId) {
      if (activeTrackId || activeLibraryItemId || ambientPlaybackState !== "idle") {
        ambientService.stopActiveTrack();
      }
      return;
    }

    if (!attachedTrackIdForLoadedBook) {
      if (activeLibraryItemId === libraryItemId || activeTrackId || ambientPlaybackState !== "idle") {
        ambientService.stopActiveTrack();
      }
      return;
    }

    if (
      activeTrackId !== attachedTrackIdForLoadedBook ||
      activeLibraryItemId !== libraryItemId ||
      ambientPlaybackState === "idle"
    ) {
      ambientService.loadAttachedTrackForBook(libraryItemId);
    }
  }, [
    activeLibraryItemId,
    activeTrackId,
    ambientPlaybackState,
    attachedTrackIdForLoadedBook,
    hasLoadedBook,
    isEnabled,
    libraryItemId,
  ]);

  useEffect(() => {
    const previousState = previousPlaybackState.current;
    const didPlaybackStateChange = previousState !== playbackState;

    previousPlaybackState.current = playbackState;

    if (!isEnabled || !hasLoadedBook || !libraryItemId) {
      return;
    }

    if (!attachedTrackIdForLoadedBook) {
      return;
    }

    const isActiveForLoadedBook =
      activeTrackId === attachedTrackIdForLoadedBook && activeLibraryItemId === libraryItemId;
    if (!isActiveForLoadedBook) {
      return;
    }

    if (!didPlaybackStateChange) {
      return;
    }

    if (playbackState === "playing" && previousState !== "playing" && ambientPlaybackState === "paused") {
      ambientService.resumeTrack();
      return;
    }

    if (previousState === "playing" && playbackState !== "playing" && ambientPlaybackState === "playing") {
      ambientService.pauseTrack();
    }
  }, [
    activeLibraryItemId,
    activeTrackId,
    ambientPlaybackState,
    attachedTrackIdForLoadedBook,
    hasLoadedBook,
    isEnabled,
    libraryItemId,
    playbackState,
  ]);

  return null;
};
