import Foundation

struct AssistantPendingSearchPayload: Codable, Equatable, Sendable {
  var query: String
  var userId: String
  var libraryId: String

  var dictionary: [String: Any] {
    ["query": query, "userId": userId, "libraryId": libraryId]
  }
}

enum AssistantPendingSearch {
  private static let defaultsKey = "laabs.assistant.pendingSearch"

  static func store(query: String, userId: String, libraryId: String) {
    guard let payload = validated(query: query, userId: userId, libraryId: libraryId) else { return }
    guard let data = try? JSONEncoder().encode(payload) else { return }
    UserDefaults.standard.set(data, forKey: defaultsKey)
  }

  static func storeSystemTerm(_ term: String) {
    let context = AssistantRuntimeContextStore.shared.current()
    guard let userId = context.userId, let libraryId = context.libraryId else { return }
    store(query: term, userId: userId, libraryId: libraryId)
  }

  static func peek() -> AssistantPendingSearchPayload? {
    guard
      let data = UserDefaults.standard.data(forKey: defaultsKey),
      let payload = try? JSONDecoder().decode(AssistantPendingSearchPayload.self, from: data)
    else { return nil }
    return validated(query: payload.query, userId: payload.userId, libraryId: payload.libraryId)
  }

  static func take() -> AssistantPendingSearchPayload? {
    let payload = peek()
    UserDefaults.standard.removeObject(forKey: defaultsKey)
    return payload
  }

  private static func validated(
    query: String,
    userId: String,
    libraryId: String
  ) -> AssistantPendingSearchPayload? {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let userId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
    let libraryId = libraryId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty, !userId.isEmpty, !libraryId.isEmpty else { return nil }
    return AssistantPendingSearchPayload(query: query, userId: userId, libraryId: libraryId)
  }
}
