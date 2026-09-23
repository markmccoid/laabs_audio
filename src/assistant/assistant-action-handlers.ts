import {
  AbsApiError,
  AbsAuthRequiredError,
  AbsOfflineError,
  AbsServerUnavailableError,
} from "@/api/abs-client";
import { authStore, selectAccessMode } from "@/auth/auth-store";
import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantPlayableRef,
} from "@/native/assistant/AssistantBridge.types";
import { episodeBookmarksStore } from "@/podcast/episode-bookmarks-store";
import { findChapterForPosition } from "@/player/chapters";
import { isStreamedPlaybackStartFailure } from "@/player/playback-start-attempt";
import { playerService } from "@/player/player-service";
import { playbackStore, type PlaybackStoreState } from "@/player/playback-store";
import { sleepTimerStore } from "@/player/sleep-timer-store";
import { deviceBooksStore } from "@/store/device-books-store";
import type { Bookmark } from "@/types/absTypes";
import { defaultAssistantBookmarkTitle } from "./assistant-bookmark-title";

const PLAYBACK_WAIT_TIMEOUT_MS = 8_000;
const NATIVE_COMPLETION_MARGIN_MS = 250;

const failure = (
  code: Extract<AssistantActionResult, { ok: false }>["code"],
  message: string,
): AssistantActionResult => ({ ok: false, code, message });

const resolveChosenAssistantUserId = (): string | null => {
  const auth = authStore.getState();
  if (auth.activeLibraryUserKey) return auth.activeLibraryUserKey;
  if (selectAccessMode(auth) === "downloadedSessionOnly") return auth.storedUserId;
  return null;
};

const playableFromState = (
  state: Pick<PlaybackStoreState, "episodeId" | "libraryItemId">,
): AssistantPlayableRef | null => {
  if (!state.libraryItemId) return null;
  return state.episodeId
    ? { kind: "episode", libraryItemId: state.libraryItemId, episodeId: state.episodeId }
    : { kind: "audiobook", libraryItemId: state.libraryItemId };
};

const isExpectedPlayable = (
  state: Pick<PlaybackStoreState, "episodeId" | "libraryItemId">,
  expected: AssistantPlayableRef,
) =>
  state.libraryItemId === expected.libraryItemId &&
  (expected.kind === "episode" ? state.episodeId === expected.episodeId : !state.episodeId);

const waitForAudiblePlayback = (
  expected: AssistantPlayableRef,
  timeoutMs = PLAYBACK_WAIT_TIMEOUT_MS,
): Promise<PlaybackStoreState> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (result: { state: PlaybackStoreState } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      if ("state" in result) resolve(result.state);
      else reject(result.error);
    };

    const evaluate = (state: PlaybackStoreState) => {
      if (!isExpectedPlayable(state, expected)) return;
      if (state.playbackState === "playing") {
        finish({ state });
      } else if (state.playbackState === "error") {
        finish({ error: new Error(state.error || "Playback failed") });
      }
    };

    unsubscribe = playbackStore.subscribe(evaluate);
    timeout = setTimeout(
      () => finish({ error: new Error("LAABS Audio did not reach audible playback.") }),
      timeoutMs,
    );
    evaluate(playbackStore.getState());
  });

const playbackFailure = (error: unknown): AssistantActionResult => {
  if (error instanceof AbsAuthRequiredError) {
    return failure("signInRequired", "Choose a LAABS Audio session before streaming.");
  }
  if (
    isStreamedPlaybackStartFailure(error) ||
    error instanceof AbsOfflineError ||
    error instanceof AbsServerUnavailableError
  ) {
    return failure("cannotStream", "That item is not downloaded and Audiobookshelf is offline.");
  }
  if (error instanceof AbsApiError && error.status === 404) {
    return failure("notFound", "That audiobook is no longer available.");
  }
  return failure(
    "playbackFailed",
    error instanceof Error ? error.message : "LAABS Audio could not start playback.",
  );
};

const activePlaybackState = (): PlaybackStoreState | null => {
  const state = playbackStore.getState();
  if (
    !state.libraryItemId ||
    state.queue.length === 0 ||
    (state.playbackState !== "ready" &&
      state.playbackState !== "playing" &&
      state.playbackState !== "paused")
  ) {
    return null;
  }
  return state;
};

const playAudiobook = async (libraryItemId: string): Promise<AssistantActionResult> => {
  const playable: AssistantPlayableRef = { kind: "audiobook", libraryItemId };
  try {
    await playerService.loadBook(libraryItemId, { autoPlay: true });
    const playing = await waitForAudiblePlayback(playable);
    return {
      ok: true,
      kind: "play",
      playable,
      title: playing.bookTitle ?? "Audiobook",
      isPlaying: true,
    };
  } catch (error) {
    return playbackFailure(error);
  }
};

const resumePersistedPlayback = async (): Promise<AssistantActionResult> => {
  const state = playbackStore.getState();
  const playable = playableFromState(state);
  if (!playable) {
    return failure("nothingPlaying", "No recent audiobook or Episode is available to resume.");
  }

  try {
    if (state.playbackState !== "playing") {
      if (state.queue.length > 0) {
        await playerService.play();
      } else if (playable.kind === "episode") {
        await playerService.loadEpisode(playable.libraryItemId, playable.episodeId, {
          autoPlay: true,
          episodeTitle: state.bookTitle,
          podcastTitle: state.secondaryTitle,
        });
      } else {
        await playerService.loadBook(playable.libraryItemId, { autoPlay: true });
      }
    }

    const playing = await waitForAudiblePlayback(playable);
    return {
      ok: true,
      kind: "resume",
      playable,
      title: playing.bookTitle ?? (playable.kind === "episode" ? "Episode" : "Audiobook"),
      isPlaying: true,
    };
  } catch (error) {
    return playbackFailure(error);
  }
};

const pauseActivePlayback = async (): Promise<AssistantActionResult> => {
  const state = playbackStore.getState();
  const hasLoadedPlayback =
    Boolean(state.libraryItemId) &&
    (state.queue.length > 0 ||
      state.playbackState === "playing" ||
      state.playbackState === "paused" ||
      state.playbackState === "ready" ||
      state.playbackState === "loading");
  // Siri's own voice already pauses the player before this runs. Pausing a
  // loaded book still clears the native "should resume when Siri leaves" flag.
  if (!hasLoadedPlayback) {
    return failure("nothingPlaying", "Nothing is currently playing.");
  }
  try {
    await playerService.pause();
    return { ok: true, kind: "pause" };
  } catch (error) {
    return playbackFailure(error);
  }
};

const bookmarkActivePlayback = async (
  requestedTitle: string | null,
  userId: string,
): Promise<AssistantActionResult> => {
  const state = activePlaybackState();
  if (!state?.libraryItemId) {
    return failure("nothingPlaying", "Load an audiobook or Episode before adding a bookmark.");
  }

  const positionSeconds = Math.floor(Math.max(0, state.positionMs) / 1_000);
  const chapterTitle = findChapterForPosition(state.chapterIndex, state.positionMs)?.title ?? null;
  const title =
    requestedTitle?.trim() || defaultAssistantBookmarkTitle(chapterTitle, positionSeconds);

  try {
    if (state.episodeId) {
      episodeBookmarksStore.getState().actions.save({
        userId,
        identity: { libraryItemId: state.libraryItemId, episodeId: state.episodeId },
        kind: "point",
        startTimeSeconds: positionSeconds,
        title,
        createdAt: Date.now(),
      });
    } else {
      const bookmark: Bookmark = {
        libraryItemId: state.libraryItemId,
        time: positionSeconds,
        title,
        createdAt: Date.now(),
      };
      await deviceBooksStore.getState().actions.addBookmark(state.libraryItemId, bookmark, {
        userKey: userId,
      });
    }

    return {
      ok: true,
      kind: "bookmarkHere",
      title,
      positionSeconds,
      playableTitle: state.bookTitle ?? (state.episodeId ? "Episode" : "Audiobook"),
    };
  } catch (error) {
    return failure(
      "playbackFailed",
      error instanceof Error ? error.message : "LAABS Audio could not save the bookmark.",
    );
  }
};

const setSleepTimer = (
  request: Extract<AssistantActionRequest, { kind: "sleepTimer" }>,
): AssistantActionResult => {
  const actions = sleepTimerStore.getState().actions;
  switch (request.mode) {
    case "cancel":
      actions.stopTimer();
      return { ok: true, kind: "sleepTimer", description: "Sleep timer cancelled." };
    case "minutes": {
      if (!activePlaybackState()) {
        return failure("nothingPlaying", "Start playback before setting a sleep timer.");
      }
      actions.startMinutesTimer(request.minutes ?? undefined);
      const minutes = sleepTimerStore.getState().draftMinutes;
      return {
        ok: true,
        kind: "sleepTimer",
        description: `Sleep timer set for ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      };
    }
    case "end_of_chapter":
    case "end_of_next_chapter": {
      const state = activePlaybackState();
      if (!state) {
        return failure("nothingPlaying", "Start playback before setting a sleep timer.");
      }
      const currentChapter = findChapterForPosition(state.chapterIndex, state.positionMs);
      const currentIndex = currentChapter
        ? state.chapterIndex.findIndex((chapter) => chapter.id === currentChapter.id)
        : -1;
      if (currentIndex < 0) {
        return failure("unsupported", "The current item does not have chapter timing.");
      }
      if (
        request.mode === "end_of_next_chapter" &&
        currentIndex >= state.chapterIndex.length - 1
      ) {
        return failure("unsupported", "There is no next chapter in the current audiobook.");
      }
      actions.startChapterTimer(request.mode);
      return {
        ok: true,
        kind: "sleepTimer",
        description:
          request.mode === "end_of_chapter"
            ? "Sleep timer set for the end of this chapter."
            : "Sleep timer set for the end of the next chapter.",
      };
    }
    default: {
      const exhaustive: never = request.mode;
      return failure("unsupported", `Unsupported sleep timer mode: ${String(exhaustive)}`);
    }
  }
};

const performAssistantAction = async (
  request: AssistantActionRequest,
  userId: string,
): Promise<AssistantActionResult> => {
  switch (request.kind) {
    case "play":
      return playAudiobook(request.libraryItemId);
    case "resume":
      return resumePersistedPlayback();
    case "pause":
      return pauseActivePlayback();
    case "bookmarkHere":
      return bookmarkActivePlayback(request.title, userId);
    case "sleepTimer":
      return setSleepTimer(request);
    default: {
      const exhaustive: never = request;
      return failure("unsupported", `Unsupported Assistant Action: ${String(exhaustive)}`);
    }
  }
};

const cancelExpiredPlaybackSideEffect = async (
  request: AssistantActionRequest,
  resumePlayable: AssistantPlayableRef | null,
) => {
  const state = playbackStore.getState();
  try {
    if (
      request.kind === "play" &&
      state.libraryItemId === request.libraryItemId &&
      !state.episodeId &&
      state.playbackState !== "idle"
    ) {
      await playerService.stop();
      return;
    }
    if (
      request.kind === "resume" &&
      resumePlayable &&
      isExpectedPlayable(state, resumePlayable) &&
      state.playbackState === "playing"
    ) {
      await playerService.pause();
    }
  } catch {
    // The request has already been answered; cancellation is best-effort.
  }
};

const invalidRequestResult = (
  request: AssistantActionRequest,
): Extract<AssistantActionResult, { ok: false }> | null => {
  const userId = resolveChosenAssistantUserId();
  if (!userId || userId !== request.expectedUserId) {
    return failure(
      "signInRequired",
      "The LAABS Audio session changed before the request could finish.",
    ) as Extract<AssistantActionResult, { ok: false }>;
  }
  if (Date.now() >= request.expiresAtMilliseconds - NATIVE_COMPLETION_MARGIN_MS) {
    return failure("timeout", "LAABS Audio could not finish before the request expired.") as Extract<
      AssistantActionResult,
      { ok: false }
    >;
  }
  return null;
};

export const handleAssistantAction = async (
  request: AssistantActionRequest,
): Promise<AssistantActionResult> => {
  const invalidAtStart = invalidRequestResult(request);
  if (invalidAtStart) return invalidAtStart;

  const resumePlayable = request.kind === "resume" ? playableFromState(playbackStore.getState()) : null;
  let finishCancellationWatch = () => {};
  const cancellation = new Promise<{
    type: "cancelled";
    result: Extract<AssistantActionResult, { ok: false }>;
  }>((resolve) => {
    let settled = false;
    const finish = (result: Extract<AssistantActionResult, { ok: false }>) => {
      if (settled) return;
      settled = true;
      clearInterval(identityTimer);
      clearTimeout(deadlineTimer);
      resolve({ type: "cancelled", result });
    };
    const identityTimer = setInterval(() => {
      const invalid = invalidRequestResult(request);
      if (invalid?.code === "signInRequired") finish(invalid);
    }, 100);
    const deadlineTimer = setTimeout(
      () => {
        const invalid = invalidRequestResult(request);
        finish(
          invalid?.code === "timeout"
            ? invalid
            : (failure("timeout", "LAABS Audio could not finish before the request expired.") as Extract<
                AssistantActionResult,
                { ok: false }
              >),
        );
      },
      Math.min(
        2_147_483_647,
        Math.max(0, request.expiresAtMilliseconds - Date.now() - NATIVE_COMPLETION_MARGIN_MS),
      ),
    );
    finishCancellationWatch = () => {
      settled = true;
      clearInterval(identityTimer);
      clearTimeout(deadlineTimer);
    };
  });

  const action = performAssistantAction(request, request.expectedUserId)
    .then((result) => ({ type: "completed" as const, result }))
    .catch((error) => ({ type: "completed" as const, result: playbackFailure(error) }));
  const winner = await Promise.race([action, cancellation]);
  finishCancellationWatch();

  if (winner.type === "completed") return winner.result;

  await cancelExpiredPlaybackSideEffect(request, resumePlayable);
  void action.then(async () => {
    if (invalidRequestResult(request)) {
      await cancelExpiredPlaybackSideEffect(request, resumePlayable);
    }
  });
  return winner.result;
};
