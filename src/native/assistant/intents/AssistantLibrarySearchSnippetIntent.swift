import AppIntents

@available(iOS 26.0, *)
struct AssistantLibrarySearchSnippetIntent: SnippetIntent {
  static var title: LocalizedStringResource = "Library Search Results"
  static var description = IntentDescription("Shows matching audiobooks from your LAABS Audio library.")
  static var isDiscoverable = false

  @Parameter(title: "Heading")
  var heading: String

  @Parameter(title: "Audiobooks")
  var books: [AssistantBookEntity]

  @Parameter(title: "Total")
  var totalCount: Int

  @Parameter(title: "Search")
  var query: String

  init() {
    heading = ""
    books = []
    totalCount = 0
    query = ""
  }

  init(
    heading: String,
    books: [AssistantBookEntity],
    totalCount: Int = 0,
    query: String = ""
  ) {
    self.heading = heading
    self.books = books
    self.totalCount = totalCount
    self.query = query
  }

  func perform() async throws -> some IntentResult & ShowsSnippetView {
    .result {
      AssistantResultSnippet(
        heading: heading,
        books: books,
        interactive: true,
        totalCount: totalCount,
        query: query
      )
    }
  }
}
