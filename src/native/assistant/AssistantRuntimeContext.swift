import Foundation

enum AssistantAccessMode: String, Codable, Sendable {
  case hydrating
  case firstRunSignInRequired
  case downloadedOnly
  case downloadedSessionOnly
  case serverSetup
  case serverBrowsing
}

struct AssistantRuntimeContext: Codable, Equatable, Sendable {
  let dbPath: String?
  let userId: String?
  let accessMode: AssistantAccessMode
  let canAttemptStreaming: Bool

  static let disabled = AssistantRuntimeContext(
    dbPath: nil,
    userId: nil,
    accessMode: .hydrating,
    canAttemptStreaming: false
  )

  init(
    dbPath: String?,
    userId: String?,
    accessMode: AssistantAccessMode,
    canAttemptStreaming: Bool
  ) {
    self.dbPath = dbPath?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    self.userId = userId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    self.accessMode = accessMode
    self.canAttemptStreaming = canAttemptStreaming
  }

  init?(dictionary: [String: Any]) {
    guard
      let accessModeValue = dictionary["accessMode"] as? String,
      let accessMode = AssistantAccessMode(rawValue: accessModeValue),
      let canAttemptStreaming = dictionary["canAttemptStreaming"] as? Bool
    else {
      return nil
    }

    self.init(
      dbPath: dictionary["dbPath"] as? String,
      userId: dictionary["userId"] as? String,
      accessMode: accessMode,
      canAttemptStreaming: canAttemptStreaming
    )
  }
}

final class AssistantRuntimeContextStore: @unchecked Sendable {
  static let shared = AssistantRuntimeContextStore()

  private static let defaultsKey = "laabs.assistant.runtimeContext"
  private let lock = NSLock()
  private var cachedContext: AssistantRuntimeContext

  private init(defaults: UserDefaults = .standard) {
    if
      let data = defaults.data(forKey: Self.defaultsKey),
      let context = try? JSONDecoder().decode(AssistantRuntimeContext.self, from: data)
    {
      cachedContext = context
    } else {
      cachedContext = .disabled
    }
  }

  func current() -> AssistantRuntimeContext {
    lock.withLock { cachedContext }
  }

  @discardableResult
  func publish(_ context: AssistantRuntimeContext) -> Bool {
    let data = try? JSONEncoder().encode(context)
    lock.withLock {
      cachedContext = context
      if let data {
        UserDefaults.standard.set(data, forKey: Self.defaultsKey)
      } else {
        UserDefaults.standard.removeObject(forKey: Self.defaultsKey)
      }
    }
    return data != nil
  }
}

private extension String {
  var nilIfEmpty: String? { isEmpty ? nil : self }
}
