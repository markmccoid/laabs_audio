import Foundation

struct AssistantActionRequest: Codable, Sendable {
  enum Kind: String, Codable, Sendable {
    case resume
  }

  let id: String
  let kind: Kind

  var dictionary: [String: Any] {
    [
      "id": id,
      "kind": kind.rawValue,
    ]
  }
}

enum AssistantActionOutcome: Sendable {
  case success(title: String, isPlaying: Bool)
  case failure(code: String, message: String)
}

private struct PendingAssistantAction: Codable, Sendable {
  let request: AssistantActionRequest
  let acceptedAtMilliseconds: Int64
  let expiresAtMilliseconds: Int64

  var isExpired: Bool {
    Int64(Date().timeIntervalSince1970 * 1000) >= expiresAtMilliseconds
  }
}

actor AssistantActionDispatcher {
  static let shared = AssistantActionDispatcher()

  private static let pendingDefaultsKey = "laabs.assistant.pendingAction"
  private static let timeoutNanoseconds: UInt64 = 10_000_000_000
  private static let timeoutMilliseconds: Int64 = 10_000

  private var isRuntimeReady = false
  private var eventEmitter: (@Sendable (AssistantActionRequest) -> Void)?
  private var pendingAction: PendingAssistantAction?
  private var continuations: [String: CheckedContinuation<AssistantActionOutcome, Never>] = [:]

  func deactivateRuntime() {
    isRuntimeReady = false
    eventEmitter = nil
  }

  func perform(_ request: AssistantActionRequest) async -> AssistantActionOutcome {
    purgeExpiredPendingAction()

    if !continuations.isEmpty || (!isRuntimeReady && pendingAction != nil) {
      return .failure(
        code: "busy",
        message: "LAABS Audio is already handling another request."
      )
    }

    return await withCheckedContinuation { continuation in
      continuations[request.id] = continuation

      Task {
        try? await Task.sleep(nanoseconds: Self.timeoutNanoseconds)
        self.timeout(id: request.id)
      }

      if isRuntimeReady, let eventEmitter {
        eventEmitter(request)
        return
      }

      let now = Int64(Date().timeIntervalSince1970 * 1000)
      let pending = PendingAssistantAction(
        request: request,
        acceptedAtMilliseconds: now,
        expiresAtMilliseconds: now + Self.timeoutMilliseconds
      )
      pendingAction = pending
      persist(pending)
    }
  }

  func activateRuntimeAndTakePending(
    eventEmitter: @escaping @Sendable (AssistantActionRequest) -> Void
  ) -> AssistantActionRequest? {
    self.eventEmitter = eventEmitter
    isRuntimeReady = true
    purgeExpiredPendingAction()

    if pendingAction == nil {
      pendingAction = loadPersistedPendingAction()
      purgeExpiredPendingAction()
    }

    guard let pendingAction else {
      return nil
    }

    self.pendingAction = nil
    clearPersistedPendingAction()
    return pendingAction.request
  }

  func complete(id: String, result: [String: Any]) {
    guard let continuation = continuations.removeValue(forKey: id) else {
      return
    }

    if pendingAction?.request.id == id {
      pendingAction = nil
      clearPersistedPendingAction()
    }

    if result["ok"] as? Bool == true {
      continuation.resume(
        returning: .success(
          title: result["title"] as? String ?? "Audiobook",
          isPlaying: result["isPlaying"] as? Bool ?? false
        )
      )
      return
    }

    continuation.resume(
      returning: .failure(
        code: result["code"] as? String ?? "playbackFailed",
        message: result["message"] as? String ?? "LAABS Audio could not complete the request."
      )
    )
  }

  private func timeout(id: String) {
    guard let continuation = continuations.removeValue(forKey: id) else {
      return
    }

    if pendingAction?.request.id == id {
      pendingAction = nil
      clearPersistedPendingAction()
    }

    continuation.resume(
      returning: .failure(
        code: "timeout",
        message: "LAABS Audio could not start playback in time."
      )
    )
  }

  private func purgeExpiredPendingAction() {
    guard pendingAction?.isExpired == true else {
      return
    }
    pendingAction = nil
    clearPersistedPendingAction()
  }

  private func persist(_ pending: PendingAssistantAction) {
    guard let data = try? JSONEncoder().encode(pending) else {
      return
    }
    UserDefaults.standard.set(data, forKey: Self.pendingDefaultsKey)
  }

  private func loadPersistedPendingAction() -> PendingAssistantAction? {
    guard
      let data = UserDefaults.standard.data(forKey: Self.pendingDefaultsKey),
      let pending = try? JSONDecoder().decode(PendingAssistantAction.self, from: data)
    else {
      clearPersistedPendingAction()
      return nil
    }
    return pending
  }

  private func clearPersistedPendingAction() {
    UserDefaults.standard.removeObject(forKey: Self.pendingDefaultsKey)
  }
}
