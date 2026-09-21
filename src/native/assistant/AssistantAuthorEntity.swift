import AppIntents
import Foundation

struct AssistantAuthorEntity: AppEntity, Identifiable {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Author")
  static var defaultQuery = AssistantAuthorQuery()

  let id: String

  @Property(title: "Author")
  var name: String

  let bookCount: Int

  init(credit: AssistantAuthorCredit) {
    id = credit.id
    bookCount = credit.bookCount
    name = credit.displayName
  }

  var displayRepresentation: DisplayRepresentation {
    let subtitle = bookCount == 1 ? "1 audiobook" : "\(bookCount) audiobooks"
    return DisplayRepresentation(title: "\(name)", subtitle: "\(subtitle)")
  }
}

struct AssistantAuthorQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [AssistantAuthorEntity.ID]) async throws -> [AssistantAuthorEntity] {
    identifiers.compactMap { AssistantCatalogReader.shared.author(byID: $0) }
      .map(AssistantAuthorEntity.init)
  }

  func entities(matching string: String) async throws -> [AssistantAuthorEntity] {
    switch AssistantCatalogReader.shared.authors(matching: string, limit: 10) {
    case .unavailable:
      return []
    case .success(let credits):
      return credits.map(AssistantAuthorEntity.init)
    }
  }

  func suggestedEntities() async throws -> [AssistantAuthorEntity] {
    switch AssistantCatalogReader.shared.authors(matching: nil, limit: 25) {
    case .unavailable:
      return []
    case .success(let credits):
      return credits.map(AssistantAuthorEntity.init)
    }
  }
}
