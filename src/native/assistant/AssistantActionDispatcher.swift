import Foundation

struct AssistantActionRequest: Codable, Sendable {
  enum Kind: String, Codable, Sendable {
    case play
    case resume
    case pause
    case bookmarkHere
    case sleepTimer
  }

  let id: String
  let kind: Kind
  let libraryItemId: String?
  let title: String?
  let mode: String?
  let minutes: Int?
  let expectedUserId: String?
  let expiresAtMilliseconds: Int64?

  init(
    id: String = UUID().uuidString,
    kind: Kind,
    libraryItemId: String? = nil,
    title: String? = nil,
    mode: String? = nil,
    minutes: Int? = nil,
    expectedUserId: String? = nil,
    expiresAtMilliseconds: Int64? = nil
  ) {
    self.id = id
    self.kind = kind
    self.libraryItemId = libraryItemId
    self.title = title
    self.mode = mode
    self.minutes = minutes
    self.expectedUserId = expectedUserId
    self.expiresAtMilliseconds = expiresAtMilliseconds
  }

  func bound(to userId: String, expiresAtMilliseconds: Int64) -> AssistantActionRequest {
    AssistantActionRequest(
      id: id,
      kind: kind,
      libraryItemId: libraryItemId,
      title: title,
      mode: mode,
      minutes: minutes,
      expectedUserId: userId,
      expiresAtMilliseconds: expiresAtMilliseconds
    )
  }

  var dictionary: [String: Any] {
    var value: [String: Any] = [
      "id": id,
      "kind": kind.rawValue,
    ]
    if let libraryItemId { value["libraryItemId"] = libraryItemId }
    if let title { value["title"] = title }
    if let mode { value["mode"] = mode }
    if let minutes { value["minutes"] = minutes }
    if let expectedUserId { value["expectedUserId"] = expectedUserId }
    if let expiresAtMilliseconds { value["expiresAtMilliseconds"] = expiresAtMilliseconds }
    return value
  }
}

enum AssistantActionOutcome: Sendable {
  case playback(title: String, isPlaying: Bool)
  case paused
  case bookmark(title: String, positionSeconds: Double, playableTitle: String)
  case sleepTimer(description: String)
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

  func runtimeIsReady() -> Bool {
    isRuntimeReady
  }

  func perform(_ request: AssistantActionRequest) async -> AssistantActionOutcome {
    purgeExpiredPendingAction()

    guard let userId = AssistantRuntimeContextStore.shared.current().userId else {
      return .failure(
        code: "signInRequired",
        message: "Choose a LAABS Audio session before using Assistant Actions."
      )
    }

    if !isRuntimeReady && request.kind != .play && request.kind != .resume {
      return .failure(
        code: "nothingPlaying",
        message: "Nothing is currently playing in LAABS Audio."
      )
    }

    if !continuations.isEmpty || (!isRuntimeReady && pendingAction != nil) {
      return .failure(
        code: "busy",
        message: "LAABS Audio is already handling another request."
      )
    }

    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let boundRequest = request.bound(
      to: userId,
      expiresAtMilliseconds: now + Self.timeoutMilliseconds
    )

    return await withCheckedContinuation { continuation in
      continuations[boundRequest.id] = continuation

      Task {
        try? await Task.sleep(nanoseconds: Self.timeoutNanoseconds)
        self.timeout(id: boundRequest.id)
      }

      if isRuntimeReady, let eventEmitter {
        eventEmitter(boundRequest)
        return
      }

      let pending = PendingAssistantAction(
        request: boundRequest,
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
      let kind = result["kind"] as? String
      switch kind {
      case "play", "resume":
        continuation.resume(
          returning: .playback(
            title: result["title"] as? String ?? "Audiobook",
            isPlaying: result["isPlaying"] as? Bool ?? false
          )
        )
      case "pause":
        continuation.resume(returning: .paused)
      case "bookmarkHere":
        continuation.resume(
          returning: .bookmark(
            title: result["title"] as? String ?? "Bookmark",
            positionSeconds: result["positionSeconds"] as? Double ?? 0,
            playableTitle: result["playableTitle"] as? String ?? "Audiobook"
          )
        )
      case "sleepTimer":
        continuation.resume(
          returning: .sleepTimer(
            description: result["description"] as? String ?? "Sleep timer updated."
          )
        )
      default:
        continuation.resume(
          returning: .failure(
            code: "unsupported",
            message: "LAABS Audio returned an unsupported result."
          )
        )
      }
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
