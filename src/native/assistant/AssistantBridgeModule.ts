import { NativeModule, requireNativeModule } from "expo";
import type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantBridgeEvents,
  AssistantPendingSearch,
  AssistantRuntimeContextPayload,
} from "./AssistantBridge.types";

declare class AssistantBridgeModule extends NativeModule<AssistantBridgeEvents> {
  publishRuntimeContext(context: AssistantRuntimeContextPayload): void;
  activateRuntimeAndTakePending(): Promise<AssistantActionRequest | null>;
  completeAction(id: string, result: AssistantActionResult): void;
  peekPendingOpen(): string | null;
  takePendingOpen(): string | null;
  peekPendingSearch(): AssistantPendingSearch | null;
  takePendingSearch(): AssistantPendingSearch | null;
  refreshSuggestedBooks(): Promise<void>;
  reindexSpotlight(userId: string | null): Promise<void>;
  clearSpotlightIndex(): Promise<void>;
}

export default requireNativeModule<AssistantBridgeModule>("AssistantBridge");
