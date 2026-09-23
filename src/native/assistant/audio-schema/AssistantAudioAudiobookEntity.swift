import AppIntents
import Foundation
import _MediaIntents_AppIntents

@available(iOS 27.0, *)
@AppEntity(schema: .audio.audiobook)
struct AssistantAudioAudiobookEntity: Identifiable {
  let id: String
  let libraryItemId: String
  let shouldResume: Bool

  var title: String?
  var author: String?
  var genre: String?
  var narrator: String?
  var publisher: String?
  var seriesTitle: String?
  var releaseDate: Date?
  var purchaseDate: Date?

  init(
    row: AssistantBookRow,
    shouldResume: Bool = false
  ) {
    id = row.id
    libraryItemId = row.libraryItemId
    self.shouldResume = shouldResume
    title = row.title
    author = row.author
    genre = nil
    narrator = row.narrator
    publisher = nil
    seriesTitle = row.seriesName
    releaseDate = nil
    purchaseDate = nil
  }

  static var defaultQuery = AssistantAudioAudiobookQuery()
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audiobook")

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: "\(title ?? "Audiobook")",
      subtitle: author.map { "by \($0)" }
    )
  }
}

@available(iOS 27.0, *)
struct AssistantAudioAudiobookQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [AssistantAudioAudiobookEntity.ID]) async throws
    -> [AssistantAudioAudiobookEntity]
  {
    identifiers.compactMap { AssistantCatalogReader.shared.book(byID: $0) }
      .map { AssistantAudioAudiobookEntity(row: $0) }
  }

  func entities(matching string: String) async throws -> [AssistantAudioAudiobookEntity] {
    switch AssistantCatalogReader.shared.playbackMatch(text: string) {
    case .unavailable, .libraryRequired, .none:
      return []
    case .unique(let row):
      return [AssistantAudioAudiobookEntity(row: row)]
    case .ambiguous(let books, _):
      return books.map { AssistantAudioAudiobookEntity(row: $0) }
    }
  }

  func suggestedEntities() async throws -> [AssistantAudioAudiobookEntity] {
    AssistantCatalogReader.shared.suggested(limit: 25)
      .map { AssistantAudioAudiobookEntity(row: $0) }
  }
}

@available(iOS 27.0, *)
struct OpenAudioSchemaAudiobookIntent: OpenIntent {
  static var title: LocalizedStringResource = "Open Audiobook"
  static var isDiscoverable = false
  static var openAppWhenRun = true

  @Parameter(title: "Audiobook")
  var target: AssistantAudioAudiobookEntity

  func perform() async throws -> some IntentResult & OpensIntent {
    AssistantPendingOpen.store(libraryItemId: target.libraryItemId)
    return .result(opensIntent: OpenLAABSIntent())
  }
}

@available(iOS 27.0, *)
@UnionValue
enum AssistantAudioEntity {
  case audiobook(AssistantAudioAudiobookEntity)
}

@available(iOS 27.0, *)
struct AssistantAudioSearchQuery: IntentValueQuery {
  typealias Input = AudioSearch
  typealias ResultValue = AssistantAudioEntity

  init() {}

  func values(for audioSearch: AudioSearch) async throws -> [AssistantAudioEntity] {
    let rows: [AssistantBookRow]
    switch audioSearch.criteria {
    case .searchQuery(let query):
      switch AssistantCatalogReader.shared.playbackMatch(text: query) {
      case .unavailable, .libraryRequired, .none:
        return []
      case .unique(let row):
        return [.audiobook(AssistantAudioAudiobookEntity(row: row))]
      case .ambiguous(let books, _):
        return books.map { .audiobook(AssistantAudioAudiobookEntity(row: $0)) }
      }
    case .unspecified:
      guard let mostRecent = AssistantCatalogReader.shared.mostRecent() else { return [] }
      return [.audiobook(AssistantAudioAudiobookEntity(row: mostRecent, shouldResume: true))]
    case .url(let urls):
      rows = urls.compactMap { url in
        guard url.scheme?.lowercased() == "laabsaudio" else { return nil }
        let libraryItemID = url.pathComponents.last(where: { $0 != "/" }) ?? url.host
        guard let libraryItemID else { return nil }
        return AssistantCatalogReader.shared.book(libraryItemID: libraryItemID)
      }
    @unknown default:
      rows = []
    }
    return rows.map { .audiobook(AssistantAudioAudiobookEntity(row: $0)) }
  }
}
