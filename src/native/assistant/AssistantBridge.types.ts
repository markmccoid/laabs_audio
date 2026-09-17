export type AssistantActionRequest = {
  id: string;
  kind: "resume";
};

export type AssistantActionSuccess = {
  ok: true;
  kind: "resume";
  title: string;
  isPlaying: boolean;
};

export type AssistantActionFailureCode =
  | "nothingPlaying"
  | "signInRequired"
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
