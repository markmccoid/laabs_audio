import AppIntents
import Foundation
internal import ExpoModulesCore

private final class AssistantBridgeEventSink: @unchecked Sendable {
  weak var module: AssistantBridge?

  init(module: AssistantBridge) {
    self.module = module
  }

  func notifyOpen() {
    DispatchQueue.main.async { [weak self] in
      self?.module?.sendEvent("onAssistantOpen", [:])
    }
  }

  func send(_ request: AssistantActionRequest) {
    DispatchQueue.main.async { [weak self] in
      self?.module?.sendEvent("onAssistantAction", request.dictionary)
    }
  }
}

class AssistantBridge: Module {
  private var pendingOpenObserver: NSObjectProtocol?

  func definition() -> ModuleDefinition {
    let eventSink = AssistantBridgeEventSink(module: self)

    Name("AssistantBridge")

    Events("onAssistantAction", "onAssistantOpen")

    OnCreate { [weak self] in
      guard let self else { return }
      self.pendingOpenObserver = NotificationCenter.default.addObserver(
        forName: AssistantPendingOpen.didStore, object: nil, queue: nil
      ) { _ in
        eventSink.notifyOpen()
      }
      AssistantShortcuts.updateAppShortcutParameters()
    }

    OnDestroy { [weak self] in
      if let observer = self?.pendingOpenObserver {
        NotificationCenter.default.removeObserver(observer)
        self?.pendingOpenObserver = nil
      }
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

    Function("peekPendingOpen") { () -> String? in
      AssistantPendingOpen.peek()
    }

    Function("peekPendingOpenRequest") { () -> [String: String]? in
      AssistantPendingOpen.peekRequest()
    }

    Function("acknowledgePendingOpen") { (requestId: String) -> Bool in
      AssistantPendingOpen.acknowledge(requestId: requestId)
    }

    Function("takePendingOpen") { () -> String? in
      AssistantPendingOpen.take()
    }

    Function("peekPendingSearch") { () -> [String: Any]? in
      AssistantPendingSearch.peek()?.dictionary
    }

    Function("takePendingSearch") { () -> [String: Any]? in
      AssistantPendingSearch.take()?.dictionary
    }
  }
}
