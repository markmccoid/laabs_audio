import type { AuthState } from "../auth/auth-store";
import type { PlaybackStoreState } from "../player/playback-store";
import type { PlaybackControlResult } from "../player/player-service";

export const WIDGET_EVENT_NAME = "AudioProWidgetEvent";
const MAX_START_ATTEMPTS = 5;

type SubscribableStore<T> = {
  getState: () => T;
  subscribe: (listener: (state: T, previousState: T) => void) => () => void;
};

type WidgetEvent = { type?: string };

export type WidgetPlaybackRequestOptions = {
  consumePendingPlayRequest: () => Promise<boolean>;
  addWidgetEventListener: (listener: (event: WidgetEvent) => void) => () => void;
  requestStart: (libraryItemId: string) => Promise<PlaybackControlResult>;
  playback: SubscribableStore<Pick<PlaybackStoreState, "libraryItemId" | "episodeId">>;
  auth: SubscribableStore<Pick<AuthState, "status">>;
};

// Plays the last book when the Home Screen widget's play button is tapped while
// no track is loaded, including a cold background launch where only this JS
// runs (see patches/expo-widgets+58.0.20.patch and AudioWidgetBridge.swift).
// Native stores the request; this consumes it once JS can load the book.
export const startWidgetPlaybackRequests = ({
  consumePendingPlayRequest,
  addWidgetEventListener,
  requestStart,
  playback,
  auth,
}: WidgetPlaybackRequestOptions) => {
  let pendingLibraryItemId: string | null = null;
  let attempts = 0;
  let busy = false;

  // Timer-free retries: setTimeout does not fire in a headless background
  // launch (see carplay-service), so auth hydration and playback store updates
  // drive the next attempt.
  const tryStart = async () => {
    const libraryItemId = pendingLibraryItemId;
    if (!libraryItemId || busy) return;
    // Streaming needs the stored session; hydration is still running at bundle load.
    if (auth.getState().status === "hydrating") return;

    busy = true;
    attempts += 1;
    try {
      const result = await requestStart(libraryItemId);
      if (result.status === "ignored" && attempts < MAX_START_ATTEMPTS) return;
      if (pendingLibraryItemId === libraryItemId) pendingLibraryItemId = null;
    } catch {
      if (pendingLibraryItemId === libraryItemId) pendingLibraryItemId = null;
    } finally {
      busy = false;
    }
  };

  const handlePlayRequest = async () => {
    const hasRequest = await consumePendingPlayRequest().catch(() => false);
    if (!hasRequest) return;

    const { libraryItemId, episodeId } = playback.getState();
    // The widget only shows audiobooks.
    if (!libraryItemId || episodeId) return;

    pendingLibraryItemId = libraryItemId;
    attempts = 0;
    await tryStart();
  };

  const removeWidgetListener = addWidgetEventListener((event) => {
    if (event?.type === "PLAY_REQUEST") void handlePlayRequest();
  });
  const unsubscribeAuth = auth.subscribe(() => void tryStart());
  const unsubscribePlayback = playback.subscribe(() => void tryStart());

  // A cold launch from the widget stored the request before JS existed.
  void handlePlayRequest();

  return () => {
    removeWidgetListener();
    unsubscribeAuth();
    unsubscribePlayback();
  };
};
