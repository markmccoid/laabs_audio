import AppIntents
import CoreSpotlight
import Foundation

enum AssistantSpotlightIndexer {
  @available(iOS 18.0, *)
  private static let index = CSSearchableIndex(name: "com.markmccoid.laabs-audio.assistant-books")

  static func reindex(userId: String?) async throws {
    guard #available(iOS 18.0, *) else { return }
    let context = AssistantRuntimeContextStore.shared.current()
    guard let userId, userId == context.userId else {
      try await clear()
      return
    }

    let books = AssistantCatalogReader.shared.all().map { AssistantBookEntity(row: $0) }
    try await index.deleteAppEntities(ofType: AssistantBookEntity.self)
    if !books.isEmpty {
      try await index.indexAppEntities(books)
    }
  }

  static func clear() async throws {
    guard #available(iOS 18.0, *) else { return }
    try await index.deleteAppEntities(ofType: AssistantBookEntity.self)
  }
}
