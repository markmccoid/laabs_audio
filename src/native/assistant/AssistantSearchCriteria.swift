import Foundation

enum AssistantAuthorCriterion: Equatable, Sendable {
  case combinedCreditEquals(String)
  case combinedCreditContains(String)
}

enum AssistantSearchSort: String, Equatable, Sendable {
  case relevance
  case title
  case author
  case recent
}

struct AssistantSearchCriteria: Equatable, Sendable {
  var text: String?
  var author: AssistantAuthorCriterion?
  var downloaded: Bool?
  var finished: Bool?
  var sort: AssistantSearchSort
  var limit: Int
  var offset: Int

  init(
    text: String? = nil,
    author: AssistantAuthorCriterion? = nil,
    downloaded: Bool? = nil,
    finished: Bool? = nil,
    sort: AssistantSearchSort = .relevance,
    limit: Int = 10,
    offset: Int = 0
  ) {
    self.text = text
    self.author = author
    self.downloaded = downloaded
    self.finished = finished
    self.sort = sort
    self.limit = min(max(limit, 1), 100)
    self.offset = min(max(offset, 0), 100_000)
  }

  var textTokens: [String] {
    AssistantText.tokens(from: text)
  }

  var normalizedText: String {
    AssistantText.normalize(text ?? "")
  }

  var diagnosticInputKind: AssistantDiagnosticInputKind {
    if author != nil && !textTokens.isEmpty { return .freeText }
    if author != nil { return .authorText }
    if !textTokens.isEmpty { return .freeText }
    return .none
  }
}

struct AssistantSearchResult: Equatable, Sendable {
  let books: [AssistantBookRow]
  let totalCount: Int
}

enum AssistantCatalogRead: Equatable, Sendable {
  case unavailable
  case libraryRequired
  case success(AssistantSearchResult)
}

enum AssistantCatalogReadAuthors: Equatable, Sendable {
  case unavailable
  case libraryRequired
  case success([AssistantAuthorCredit])
}

enum AssistantPlaybackMatch: Equatable, Sendable {
  case unavailable
  case libraryRequired
  case none
  case unique(AssistantBookRow)
  case ambiguous(books: [AssistantBookRow], totalCount: Int)
}

extension AssistantText {
  static func tokens(from value: String?) -> [String] {
    let normalized = normalize(value ?? "")
    guard !normalized.isEmpty else { return [] }
    return normalized.split(whereSeparator: \.isWhitespace).map(String.init)
  }
}

struct AssistantAuthorCredit: Equatable, Sendable {
  let userId: String
  let displayName: String
  let normalized: String
  let bookCount: Int

  var id: String { "\(userId)|\(normalized)" }

  init?(userId: String, displayName: String, normalized: String, bookCount: Int) {
    guard !userId.isEmpty, !userId.contains("|"), !normalized.isEmpty, !normalized.contains("|")
    else { return nil }
    self.userId = userId
    self.displayName = displayName
    self.normalized = normalized
    self.bookCount = max(bookCount, 0)
  }

  init?(rawID: String, displayName: String = "", bookCount: Int = 0) {
    let parts = rawID.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    self.init(
      userId: String(parts[0]),
      displayName: displayName,
      normalized: String(parts[1]),
      bookCount: bookCount
    )
  }
}

enum AssistantSearchCopy {
  static let spokenTitleLimit = 5
  static let displayedBookLimit = 10

  static func catalogUnavailable() -> String {
    "I can't search your LAABS Audio library right now. Open the app to refresh it."
  }

  static func libraryRequired() -> String {
    "Open LAABS Audio and choose a library first."
  }

  static func openAppSearch(query: String) -> String {
    "Open LAABS Audio to search for \(query)?"
  }

  static func searchDialog(query: String, totalCount: Int, titles: [String]) -> String {
    listDialog(
      zero: "I couldn't find \(query) in your LAABS Audio library.",
      one: { "I found \($0) in your LAABS Audio library." },
      many: { count, spoken in
        "I found \(count) audiobooks matching \(query), including \(spoken)."
      },
      totalCount: totalCount,
      titles: titles
    )
  }

  static func authorDialog(author: String, totalCount: Int, titles: [String]) -> String {
    listDialog(
      zero: "I couldn't find books by \(author) in your LAABS Audio library.",
      one: { "You have 1 book by \(author): \($0)." },
      many: { count, spoken in
        "You have \(count) books by \(author), including \(spoken)."
      },
      totalCount: totalCount,
      titles: titles
    )
  }

  private static func listDialog(
    zero: String,
    one: (String) -> String,
    many: (Int, String) -> String,
    totalCount: Int,
    titles: [String]
  ) -> String {
    if totalCount <= 0 || titles.isEmpty { return zero }
    if totalCount == 1, let title = titles.first { return one(title) }
    let spoken = spokenTitles(titles)
    var dialog = many(totalCount, spoken)
    if totalCount > min(titles.count, spokenTitleLimit) {
      dialog += " There are more in your available catalog."
    }
    return dialog
  }

  static func spokenTitles(_ titles: [String]) -> String {
    let limited = Array(titles.prefix(spokenTitleLimit))
    switch limited.count {
    case 0:
      return ""
    case 1:
      return limited[0]
    case 2:
      return "\(limited[0]) and \(limited[1])"
    default:
      let head = limited.dropLast().joined(separator: ", ")
      return "\(head), and \(limited[limited.count - 1])"
    }
  }
}
