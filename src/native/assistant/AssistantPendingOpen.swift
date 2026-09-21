import Foundation

enum AssistantPendingOpen {
  private static let defaultsKey = "laabs.assistant.pendingOpenLibraryItemId"

  static func store(libraryItemId: String) {
    let trimmed = libraryItemId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    UserDefaults.standard.set(trimmed, forKey: defaultsKey)
  }

  static func peek() -> String? {
    let value = UserDefaults.standard.string(forKey: defaultsKey)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let value, !value.isEmpty else { return nil }
    return value
  }

  static func take() -> String? {
    let value = peek()
    UserDefaults.standard.removeObject(forKey: defaultsKey)
    return value
  }
}
