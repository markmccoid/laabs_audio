import { NativeModule, requireNativeModule } from "expo";
import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantBridgeEvents,
} from "./AssistantBridge.types";

declare class AssistantBridgeModule extends NativeModule<AssistantBridgeEvents> {
  publishRuntimeContext(context: {
    dbPath: string;
    userId: string | null;
    accessMode: string;
    canAttemptStreaming: boolean;
  }): void;
  activateRuntimeAndTakePending(): Promise<AssistantActionRequest | null>;
  completeAction(id: string, result: AssistantActionResult): void;
}

export default requireNativeModule<AssistantBridgeModule>("AssistantBridge");
