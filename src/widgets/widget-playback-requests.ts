import type { AuthState } from "../auth/auth-store";
import type { PlaybackStoreState } from "../player/playback-store";
import type { PlaybackControlResult } from "../player/player-service";

export const WIDGET_EVENT_NAME = "AudioProWidgetEvent";

type SubscribableStore<T> = {
  getState: () => T;
  subscribe: (listener: (state: T, previousState: T) => void) => () => void;
};

type WidgetEvent = { type?: string };

export type WidgetPlaybackRequestOptions = {
  consumePendingPlayRequest: () => Promise<boolean>;
  /** Shows Play on the widget again and releases the native background task. */
  abandonPlayRequest: () => void;
  addWidgetEventListener: (listener: (event: WidgetEvent) => void) => () => void;
  requestStart: (libraryItemId: string) => Promise<PlaybackControlResult>;
  playback: SubscribableStore<
    Pick<PlaybackStoreState, "libraryItemId" | "episodeId" | "playbackState">
  >;
  auth: SubscribableStore<Pick<AuthState, "status">>;
};

// Plays the last book when the Home Screen widget's play button is tapped while
// no track is loaded, including a cold background launch where only this JS
// runs (see patches/expo-widgets+58.0.20.patch and AudioWidgetBridge.swift).
// Native stores the request; this consumes it once JS can load the book.
export const startWidgetPlaybackRequests = ({
  consumePendingPlayRequest,
  abandonPlayRequest,
  addWidgetEventListener,
  requestStart,
  playback,
  auth,
}: WidgetPlaybackRequestOptions) => {
  let pendingLibraryItemId: string | null = null;

  // Started once auth hydration settles. setTimeout does not fire in a headless
  // background launch (see carplay-service), so the auth subscription drives it.
  const tryStart = async () => {
    const libraryItemId = pendingLibraryItemId;
    if (!libraryItemId) return;
    // Streaming needs the stored session; hydration is still running at bundle load.
    if (auth.getState().status === "hydrating") return;

    pendingLibraryItemId = null;
    let started = false;
    try {
      await requestStart(libraryItemId);
      started = playback.getState().playbackState !== "error";
    } catch {
      // Reported below: the widget must not keep showing Pause.
    }
    if (!started) abandonPlayRequest();
  };

  const handlePlayRequest = async () => {
    const hasRequest = await consumePendingPlayRequest().catch(() => false);
    if (!hasRequest) return;

    const { libraryItemId, episodeId } = playback.getState();
    // The widget only shows audiobooks.
    if (!libraryItemId || episodeId) {
      abandonPlayRequest();
      return;
    }

    pendingLibraryItemId = libraryItemId;
    await tryStart();
  };

  const removeWidgetListener = addWidgetEventListener((event) => {
    if (event?.type === "PLAY_REQUEST") void handlePlayRequest();
  });
  const unsubscribeAuth = auth.subscribe(() => void tryStart());

  // A cold launch from the widget stored the request before JS existed.
  void handlePlayRequest();

  return () => {
    removeWidgetListener();
    unsubscribeAuth();
  };
};
