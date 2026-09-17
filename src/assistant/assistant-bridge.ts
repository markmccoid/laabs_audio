import {
  AssistantBridgeModule,
  type AssistantActionRequest,
  type AssistantActionResult,
} from "@/native/assistant";

type AssistantActionHandler = (
  request: AssistantActionRequest,
) => Promise<AssistantActionResult>;

type StartAssistantRuntimeOptions = {
  handler: AssistantActionHandler;
  onPendingAction: (request: AssistantActionRequest | null) => void;
};

const unexpectedFailure = (error: unknown): AssistantActionResult => ({
  ok: false,
  code: "playbackFailed",
  message: error instanceof Error ? error.message : "LAABS Audio could not complete the request.",
});

const handleAndComplete = async (
  request: AssistantActionRequest,
  handler: AssistantActionHandler,
) => {
  let result: AssistantActionResult;
  try {
    result = await handler(request);
  } catch (error) {
    result = unexpectedFailure(error);
  }
  AssistantBridgeModule.completeAction(request.id, result);
};

export const startAssistantActionRuntime = async ({
  handler,
  onPendingAction,
}: StartAssistantRuntimeOptions): Promise<() => void> => {
  const subscription = AssistantBridgeModule.addListener("onAssistantAction", (request) => {
    void handleAndComplete(request, handler);
  });

  try {
    const pendingAction = await AssistantBridgeModule.activateRuntimeAndTakePending();
    onPendingAction(pendingAction);
    if (pendingAction) {
      void handleAndComplete(pendingAction, handler);
    }
  } catch (error) {
    subscription.remove();
    throw error;
  }

  return () => subscription.remove();
};
