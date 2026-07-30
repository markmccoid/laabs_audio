import type { AuthState } from "../auth/auth-store";
import { createSharedBookLink } from "../navigation/book-links";
import type { PlaybackStoreState } from "../player/playback-store";
import {
  AUDIO_WIDGET_SNAPSHOT_VERSION,
  buildAudioWidgetMinuteTimeline,
  createEmptyAudioWidgetSnapshot,
  type AudioWidgetSnapshot,
  type AudioWidgetTimelineEntry,
} from "./widget-snapshot";

type SubscribableStore<T> = {
  getState: () => T;
  subscribe: (listener: (state: T, previousState: T) => void) => () => void;
};

export type AudioWidgetPublisherTarget = {
  updateTimeline: (entries: AudioWidgetTimelineEntry[]) => void;
};

type WidgetPlaybackState = Extract<
  PlaybackStoreState["playbackState"],
  "ready" | "playing" | "paused"
>;

type ActiveAudiobookPlaybackState = Pick<
  PlaybackStoreState,
  | "bookTitle"
  | "durationMs"
  | "episodeId"
  | "libraryItemId"
  | "playbackState"
  | "positionMs"
  | "queue"
  | "rate"
>;

type WidgetAuthState = Pick<AuthState, "activeLibraryId" | "activeLibraryUserKey">;

export type ActiveAudiobookWidgetSnapshotOptions = {
  now?: () => number;
  resolveArtworkUri?: (payload: {
    artworkUri: string | undefined;
    libraryItemId: string;
  }) => string | null;
  createDetailUrl?: (libraryItemId: string) => string;
};

export type ActiveAudiobookWidgetPublisherOptions =
  ActiveAudiobookWidgetSnapshotOptions & {
    widget: AudioWidgetPublisherTarget;
    playback: SubscribableStore<PlaybackStoreState>;
    auth: SubscribableStore<AuthState>;
    minuteCount?: number;
  };

export type ActiveAudiobookWidgetPublisher = {
  refresh: () => void;
  stop: () => void;
};

const ACTIVE_WIDGET_PLAYBACK_STATES = new Set<PlaybackStoreState["playbackState"]>([
  "ready",
  "playing",
  "paused",
]);

const nonEmpty = (value: string | null | undefined) => value?.trim() || null;

const isWidgetPlaybackState = (
  state: PlaybackStoreState["playbackState"],
): state is WidgetPlaybackState => ACTIVE_WIDGET_PLAYBACK_STATES.has(state);

export const createActiveAudiobookWidgetSnapshot = (
  playback: ActiveAudiobookPlaybackState,
  auth: WidgetAuthState,
  options: ActiveAudiobookWidgetSnapshotOptions = {},
): AudioWidgetSnapshot => {
  const publishedAtMs = (options.now ?? Date.now)();
  const libraryItemId = nonEmpty(playback.libraryItemId);
  const userKey = nonEmpty(auth.activeLibraryUserKey);
  const libraryId = nonEmpty(auth.activeLibraryId);
  const firstTrack = playback.queue[0];

  if (
    !libraryItemId ||
    !userKey ||
    !libraryId ||
    !firstTrack ||
    playback.episodeId ||
    !isWidgetPlaybackState(playback.playbackState)
  ) {
    return createEmptyAudioWidgetSnapshot(publishedAtMs);
  }

  let artworkUri: string | null = null;
  try {
    artworkUri =
      options.resolveArtworkUri?.({
        artworkUri: firstTrack.artworkUri,
        libraryItemId,
      }) ?? null;
  } catch {
    // Artwork is optional. A cache miss must not prevent playback data from publishing.
  }

  return {
    version: AUDIO_WIDGET_SNAPSHOT_VERSION,
    publishedAtMs,
    scope: { userKey, libraryId },
    status: "active",
    media: {
      kind: "audiobook",
      libraryItemId,
      episodeId: null,
      title: nonEmpty(playback.bookTitle) ?? nonEmpty(firstTrack.title) ?? "Unknown",
      creator: nonEmpty(firstTrack.author) ?? "Unknown author",
      artworkUri,
      detailUrl: (options.createDetailUrl ?? createSharedBookLink)(libraryItemId),
      playback: {
        state: playback.playbackState === "playing" ? "playing" : "paused",
        positionMs: playback.positionMs,
        durationMs: playback.durationMs,
        rate: playback.rate,
        anchorTimestampMs: publishedAtMs,
      },
    },
    candidates: [],
    warning: null,
  };
};

const buildPublicationSignature = (snapshot: AudioWidgetSnapshot) => {
  const media = snapshot.media;
  if (!media) return "empty";

  const playback = media.playback;
  const progressMinute = Math.floor(Math.max(0, playback.positionMs) / 60_000);
  return JSON.stringify([
    snapshot.scope?.userKey,
    snapshot.scope?.libraryId,
    media.libraryItemId,
    media.title,
    media.creator,
    media.artworkUri,
    media.detailUrl,
    playback.state,
    progressMinute,
    playback.durationMs,
    playback.rate,
  ]);
};

export const startActiveAudiobookWidgetPublisher = (
  options: ActiveAudiobookWidgetPublisherOptions,
): ActiveAudiobookWidgetPublisher => {
  const { playback, auth } = options;
  let lastPublicationSignature: string | null = null;

  const publish = () => {
    const snapshot = createActiveAudiobookWidgetSnapshot(
      playback.getState(),
      auth.getState(),
      options,
    );
    const signature = buildPublicationSignature(snapshot);
    if (signature === lastPublicationSignature) return;

    lastPublicationSignature = signature;
    options.widget.updateTimeline(
      buildAudioWidgetMinuteTimeline(snapshot, {
        startTimestampMs: snapshot.publishedAtMs,
        minuteCount: options.minuteCount,
      }),
    );
  };

  const unsubscribePlayback = playback.subscribe(publish);
  const unsubscribeAuth = auth.subscribe(publish);
  publish();

  return {
    refresh: publish,
    stop: () => {
      unsubscribePlayback();
      unsubscribeAuth();
    },
  };
};
