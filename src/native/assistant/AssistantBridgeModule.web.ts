import { NativeModule, registerWebModule } from "expo";
import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantBridgeEvents,
  AssistantPendingSearch,
  AssistantRuntimeContextPayload,
} from "./AssistantBridge.types";

class AssistantBridgeModule extends NativeModule<AssistantBridgeEvents> {
  publishRuntimeContext(_context: AssistantRuntimeContextPayload): void {}

  async activateRuntimeAndTakePending(): Promise<AssistantActionRequest | null> {
    return null;
  }

  completeAction(_id: string, _result: AssistantActionResult): void {}

  peekPendingOpen(): string | null {
    return null;
  }

  takePendingOpen(): string | null {
    return null;
  }

  peekPendingSearch(): AssistantPendingSearch | null {
    return null;
  }

  takePendingSearch(): AssistantPendingSearch | null {
    return null;
  }

  async refreshSuggestedBooks(): Promise<void> {}

  async reindexSpotlight(_userId: string | null): Promise<void> {}

  async clearSpotlightIndex(): Promise<void> {}
}

export default registerWebModule(AssistantBridgeModule, "AssistantBridge");
