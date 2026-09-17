import { authStore, selectAccessMode } from "@/auth/auth-store";
import type {
  AssistantActionRequest,
  AssistantActionResult,
} from "@/native/assistant/AssistantBridge.types";
import { playerService } from "@/player/player-service";
import { playbackStore } from "@/player/playback-store";

const failure = (
  code: Extract<AssistantActionResult, { ok: false }>["code"],
  message: string,
): AssistantActionResult => ({ ok: false, code, message });

const hasChosenAssistantSession = () => {
  const auth = authStore.getState();
  const accessMode = selectAccessMode(auth);

  if (auth.activeLibraryUserKey) return true;
  return accessMode === "downloadedSessionOnly" && Boolean(auth.storedUserId);
};

const resumePersistedPlayback = async (): Promise<AssistantActionResult> => {
  if (!hasChosenAssistantSession()) {
    return failure("signInRequired", "Choose a LAABS Audio session before using Assistant Actions.");
  }

  const state = playbackStore.getState();
  if (!state.libraryItemId) {
    return failure("nothingPlaying", "No recent audiobook or Episode is available to resume.");
  }

  try {
    if (state.playbackState === "playing") {
      return {
        ok: true,
        kind: "resume",
        title: state.bookTitle ?? "Audiobook",
        isPlaying: true,
      };
    }

    if (state.queue.length > 0) {
      await playerService.play();
    } else if (state.episodeId) {
      await playerService.loadEpisode(state.libraryItemId, state.episodeId, {
        autoPlay: true,
        episodeTitle: state.bookTitle,
        podcastTitle: state.secondaryTitle,
      });
    } else {
      await playerService.loadBook(state.libraryItemId, { autoPlay: true });
    }

    const resumed = playbackStore.getState();
    if (resumed.playbackState !== "playing") {
      return failure("playbackFailed", "LAABS Audio did not reach audible playback.");
    }

    return {
      ok: true,
      kind: "resume",
      title: resumed.bookTitle ?? "Audiobook",
      isPlaying: true,
    };
  } catch (error) {
    return failure(
      "playbackFailed",
      error instanceof Error ? error.message : "LAABS Audio could not resume playback.",
    );
  }
};

export const handleAssistantAction = async (
  request: AssistantActionRequest,
): Promise<AssistantActionResult> => {
  switch (request.kind) {
    case "resume":
      return resumePersistedPlayback();
    default: {
      const exhaustive: never = request.kind;
      return failure("unsupported", `Unsupported Assistant Action: ${String(exhaustive)}`);
    }
  }
};
