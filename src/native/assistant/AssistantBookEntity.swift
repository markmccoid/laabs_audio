import AppIntents
import CoreSpotlight
import Foundation

enum AssistantBookLinks {
  static func url(libraryItemId: String) -> URL? {
    let encoded = libraryItemId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
      ?? libraryItemId
    return URL(string: "laabsaudio://book/\(encoded)")
  }
}

struct AssistantBookEntity: AppEntity, Identifiable {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audiobook")
  static var defaultQuery = AssistantBookQuery()

  let id: String

  @Property(title: "Title")
  var title: String

  @Property(title: "Author")
  var author: String?

  @Property(title: "Narrator")
  var narrator: String?

  @Property(title: "Series")
  var series: String?

  @Property(title: "Progress")
  var progressPercent: Double

  @Property(title: "Finished")
  var isFinished: Bool

  @Property(title: "Downloaded")
  var isDownloaded: Bool

  let libraryItemId: String
  let coverPath: String?
  let coverURL: String?

  var detailURL: URL? {
    AssistantBookLinks.url(libraryItemId: libraryItemId)
  }

  init(row: AssistantBookRow) {
    id = row.id
    libraryItemId = row.libraryItemId
    coverPath = row.coverPath
    coverURL = row.coverURL
    title = row.title
    author = row.author
    narrator = row.narrator
    series = row.seriesName
    progressPercent = row.progressPercent
    isFinished = row.isFinished
    isDownloaded = row.isDownloaded
  }

  var displayRepresentation: DisplayRepresentation {
    let percent = Int((progressPercent * 100).rounded())
    let byline = author.map { "by \($0)" } ?? "Unknown author"
    let image: DisplayRepresentation.Image
    if let coverPath, FileManager.default.fileExists(atPath: coverPath) {
      image = .init(url: URL(fileURLWithPath: coverPath))
    } else if let coverURL, let url = URL(string: coverURL) {
      image = .init(url: url)
    } else {
      image = .init(systemName: "book.closed.fill")
    }
    return DisplayRepresentation(
      title: "\(title)",
      subtitle: "\(byline) · \(percent)%",
      image: image
    )
  }
}

@available(iOS 18.0, *)
extension AssistantBookEntity: IndexedEntity {
  var attributeSet: CSSearchableItemAttributeSet {
    let attributes = defaultAttributeSet
    attributes.title = title
    attributes.contentDescription = [
      author.map { "by \($0)" },
      narrator.map { "Narrated by \($0)" },
    ].compactMap { $0 }.joined(separator: " · ")
    attributes.keywords = [author, series, narrator].compactMap { $0 }
    if let coverPath, FileManager.default.fileExists(atPath: coverPath) {
      attributes.thumbnailURL = URL(fileURLWithPath: coverPath)
    }
    attributes.contentURL = AssistantBookLinks.url(libraryItemId: libraryItemId)
    return attributes
  }
}

struct AssistantBookQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [AssistantBookEntity.ID]) async throws -> [AssistantBookEntity] {
    identifiers.compactMap { AssistantCatalogReader.shared.book(byID: $0) }
      .map { AssistantBookEntity(row: $0) }
  }

  func entities(matching string: String) async throws -> [AssistantBookEntity] {
    switch AssistantCatalogReader.shared.playbackMatch(text: string) {
    case .unavailable, .libraryRequired, .none:
      return []
    case .unique(let row):
      return [AssistantBookEntity(row: row)]
    case .ambiguous(let books, _):
      return books.map { AssistantBookEntity(row: $0) }
    }
  }

  func suggestedEntities() async throws -> [AssistantBookEntity] {
    AssistantCatalogReader.shared.suggested(limit: 25).map { AssistantBookEntity(row: $0) }
  }
}
