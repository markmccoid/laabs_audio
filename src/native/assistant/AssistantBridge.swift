import AppIntents
internal import ExpoModulesCore

private final class AssistantBridgeEventSink: @unchecked Sendable {
  weak var module: AssistantBridge?

  init(module: AssistantBridge) {
    self.module = module
  }

  func send(_ request: AssistantActionRequest) {
    DispatchQueue.main.async { [weak self] in
      self?.module?.sendEvent("onAssistantAction", request.dictionary)
    }
  }
}

class AssistantBridge: Module {
  func definition() -> ModuleDefinition {
    let eventSink = AssistantBridgeEventSink(module: self)

    Name("AssistantBridge")

    Events("onAssistantAction")

    OnCreate {
      AssistantSpikeShortcuts.updateAppShortcutParameters()
    }

    OnDestroy {
      Task {
        await AssistantActionDispatcher.shared.deactivateRuntime()
      }
    }

    AsyncFunction("activateRuntimeAndTakePending") { (promise: Promise) in
      Task {
        let request = await AssistantActionDispatcher.shared.activateRuntimeAndTakePending {
          request in
          eventSink.send(request)
        }
        promise.resolve(request?.dictionary)
      }
    }

    Function("completeAction") { (id: String, result: [String: Any]) in
      Task {
        await AssistantActionDispatcher.shared.complete(id: id, result: result)
      }
    }
  }
}
