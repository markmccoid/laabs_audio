import AppIntents
import Foundation

@available(iOS 18.0, *)
@AppEntity(schema: .books.audiobook)
struct AssistantBooksAudiobookEntity: Identifiable {
  let id: String
  let libraryItemId: String

  @Property(title: "Title")
  var title: String?

  @Property(title: "Author")
  var author: String?

  var url: URL?
  var seriesTitle: String?
  var purchaseDate: Date?
  var genre: String?

  init(row: AssistantBookRow) {
    id = row.id
    libraryItemId = row.libraryItemId
    title = row.title
    author = row.author
    url = URL(string: "laabsaudio:///\(row.libraryItemId)")
    seriesTitle = row.seriesName
    purchaseDate = nil
    genre = nil
  }

  static var defaultQuery = AssistantBooksAudiobookQuery()
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audiobook")

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: "\(title ?? "Audiobook")",
      subtitle: author.map { "by \($0)" }
    )
  }
}

@available(iOS 18.0, *)
struct AssistantBooksAudiobookQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [AssistantBooksAudiobookEntity.ID]) async throws
    -> [AssistantBooksAudiobookEntity]
  {
    identifiers.compactMap { AssistantCatalogReader.shared.book(byID: $0) }
      .map { AssistantBooksAudiobookEntity(row: $0) }
  }

  func entities(matching string: String) async throws -> [AssistantBooksAudiobookEntity] {
    switch AssistantCatalogReader.shared.playbackMatch(text: string) {
    case .unavailable, .none:
      return []
    case .unique(let row):
      return [AssistantBooksAudiobookEntity(row: row)]
    case .ambiguous(let books, _):
      return books.map { AssistantBooksAudiobookEntity(row: $0) }
    }
  }

  func suggestedEntities() async throws -> [AssistantBooksAudiobookEntity] {
    AssistantCatalogReader.shared.suggested(limit: 25)
      .map { AssistantBooksAudiobookEntity(row: $0) }
  }
}
