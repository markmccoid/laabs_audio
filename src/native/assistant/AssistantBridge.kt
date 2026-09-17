package expo.modules.assistantbridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AssistantBridge : Module() {
  override fun definition() = ModuleDefinition {
    Name("AssistantBridge")

    Events("onAssistantAction")

    AsyncFunction("activateRuntimeAndTakePending") {
      null
    }

    Function("completeAction") { _: String, _: Map<String, Any?> ->
      Unit
    }
  }
}
