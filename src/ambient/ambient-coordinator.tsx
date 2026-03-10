import { useEffect, useRef } from "react";
import { useAmbientActions, useAmbientStore } from "@/store/store-ambient";
import { usePlaybackStore } from "@/player";
import { ambientService } from "./ambient-service";

export const AmbientCoordinator = () => {
  const selectedTrackId = useAmbientStore((state) => state.selectedTrackId);
  const ambientPlaybackState = useAmbientStore((state) => state.playbackState);
  const selectedLibraryItemId = useAmbientStore((state) => state.selectedLibraryItemId);
  const syncSelectedLibraryItem = useAmbientActions().syncSelectedLibraryItem;
  const playbackState = usePlaybackStore((state) => state.playbackState);
  const libraryItemId = usePlaybackStore((state) => state.libraryItemId);
  const previousLibraryItemId = useRef<string | null>(libraryItemId);
  const previousPlaybackState = useRef(playbackState);

  useEffect(() => {
    if (selectedTrackId) {
      if (selectedLibraryItemId !== libraryItemId) {
        syncSelectedLibraryItem(libraryItemId);
      }
    } else if (selectedLibraryItemId !== null) {
      syncSelectedLibraryItem(null);
    }

    const previousLibrary = previousLibraryItemId.current;
    const didLibraryChange = previousLibrary !== libraryItemId;

    if (selectedTrackId && didLibraryChange) {
      ambientService.stopAndClearSelection();
    }

    previousLibraryItemId.current = libraryItemId;
  }, [libraryItemId, selectedLibraryItemId, selectedTrackId, syncSelectedLibraryItem]);

  useEffect(() => {
    if (!selectedTrackId) {
      previousPlaybackState.current = playbackState;
      return;
    }

    const previousState = previousPlaybackState.current;

    if (playbackState === "playing" && previousState !== "playing" && ambientPlaybackState === "paused") {
      ambientService.resumeTrack();
    }

    if (playbackState === "paused" && previousState !== "paused" && ambientPlaybackState === "playing") {
      ambientService.pauseTrack();
    }

    if (
      (playbackState === "idle" || playbackState === "ended" || playbackState === "error") &&
      previousState !== playbackState
    ) {
      ambientService.stopAndClearSelection();
    }

    previousPlaybackState.current = playbackState;
  }, [ambientPlaybackState, playbackState, selectedTrackId]);

  return null;
};
