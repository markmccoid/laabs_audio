type AssistantActionRequestContext = {
  id: string;
  expectedUserId: string;
  expiresAtMilliseconds: number;
};

export type AssistantActionRequest = AssistantActionRequestContext &
  (
  | { kind: "play"; libraryItemId: string }
  | { kind: "resume" }
  | { kind: "pause" }
  | { kind: "bookmarkHere"; title: string | null }
  | {
      kind: "sleepTimer";
      mode: "minutes" | "end_of_chapter" | "end_of_next_chapter" | "cancel";
      minutes: number | null;
    }
  );

export type AssistantPlayableRef =
  | { kind: "audiobook"; libraryItemId: string }
  | { kind: "episode"; libraryItemId: string; episodeId: string };

export type AssistantActionSuccess =
  | {
      ok: true;
      kind: "play" | "resume";
      playable: AssistantPlayableRef;
      title: string;
      isPlaying: boolean;
    }
  | { ok: true; kind: "pause" }
  | {
      ok: true;
      kind: "bookmarkHere";
      title: string;
      positionSeconds: number;
      playableTitle: string;
    }
  | { ok: true; kind: "sleepTimer"; description: string };

export type AssistantActionFailureCode =
  | "nothingPlaying"
  | "signInRequired"
  | "cannotStream"
  | "notFound"
  | "playbackFailed"
  | "timeout"
  | "busy"
  | "unsupported";

export type AssistantActionFailure = {
  ok: false;
  code: AssistantActionFailureCode;
  message: string;
};

export type AssistantActionResult = AssistantActionSuccess | AssistantActionFailure;

export type AssistantBridgeEvents = {
  onAssistantAction: (request: AssistantActionRequest) => void;
};

export type AssistantPendingSearch = {
  query: string;
  userId: string;
  libraryId: string;
};

export type AssistantRuntimeContextPayload = {
  dbPath: string;
  userId: string | null;
  libraryId: string | null;
  accessMode: string;
  canAttemptStreaming: boolean;
};
