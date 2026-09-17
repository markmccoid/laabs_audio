import { NativeModule, registerWebModule } from "expo";
import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantBridgeEvents,
} from "./AssistantBridge.types";

class AssistantBridgeModule extends NativeModule<AssistantBridgeEvents> {
  publishRuntimeContext(_context: {
    dbPath: string;
    userId: string | null;
    accessMode: string;
    canAttemptStreaming: boolean;
  }): void {}

  async activateRuntimeAndTakePending(): Promise<AssistantActionRequest | null> {
    return null;
  }

  completeAction(_id: string, _result: AssistantActionResult): void {}
}

export default registerWebModule(AssistantBridgeModule, "AssistantBridge");
