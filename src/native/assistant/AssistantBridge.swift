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
      AssistantShortcuts.updateAppShortcutParameters()
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

    Function("publishRuntimeContext") { (context: [String: Any]) -> Bool in
      guard let runtimeContext = AssistantRuntimeContext(dictionary: context) else {
        return false
      }
      return AssistantRuntimeContextStore.shared.publish(runtimeContext)
    }

    AsyncFunction("refreshSuggestedBooks") { (promise: Promise) in
      AssistantShortcuts.updateAppShortcutParameters()
      promise.resolve(nil)
    }

    AsyncFunction("reindexSpotlight") { (userId: String?, promise: Promise) in
      Task {
        do {
          try await AssistantSpotlightIndexer.reindex(userId: userId)
          promise.resolve(nil)
        } catch {
          promise.reject("assistant_spotlight_reindex_failed", error.localizedDescription)
        }
      }
    }

    AsyncFunction("clearSpotlightIndex") { (promise: Promise) in
      Task {
        do {
          try await AssistantSpotlightIndexer.clear()
          promise.resolve(nil)
        } catch {
          promise.reject("assistant_spotlight_clear_failed", error.localizedDescription)
        }
      }
    }
  }
}
