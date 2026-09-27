import Foundation

enum AssistantPendingOpen {
  static let didStore = Notification.Name("laabs.assistant.pendingOpenDidStore")
  private static let legacyDefaultsKey = "laabs.assistant.pendingOpenLibraryItemId"
  private static let defaultsKey = "laabs.assistant.pendingOpenRequest"
  private static let lock = NSLock()

  static func store(libraryItemId: String) {
    let trimmed = libraryItemId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    lock.lock()
    UserDefaults.standard.set(
      ["id": UUID().uuidString, "libraryItemId": trimmed], forKey: defaultsKey
    )
    UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
    lock.unlock()
    // Persist first: a bridge created after this notification can still recover the request.
    NotificationCenter.default.post(name: didStore, object: nil)
  }

  // Called only while holding the lock. The entire request is saved in one defaults value.
  private static func readRequest() -> [String: String]? {
    if let request = UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: String],
      let id = request["id"], !id.isEmpty,
      let libraryItemId = request["libraryItemId"], !libraryItemId.isEmpty
    {
      return request
    }
    // Preserve a destination saved by a previous build.
    let value = UserDefaults.standard.string(forKey: legacyDefaultsKey)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let value, !value.isEmpty else { return nil }
    let request = ["id": UUID().uuidString, "libraryItemId": value]
    UserDefaults.standard.set(request, forKey: defaultsKey)
    UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
    return request
  }

  static func peekRequest() -> [String: String]? {
    lock.lock()
    defer { lock.unlock() }
    return readRequest()
  }

  static func peek() -> String? {
    peekRequest()?["libraryItemId"]
  }

  static func acknowledge(requestId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard readRequest()?["id"] == requestId else { return false }
    UserDefaults.standard.removeObject(forKey: defaultsKey)
    return true
  }

  static func take() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let value = readRequest()?["libraryItemId"]
    UserDefaults.standard.removeObject(forKey: defaultsKey)
    UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
    return value
  }
}
