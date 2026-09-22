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

  init() {
    heading = ""
    books = []
  }

  init(heading: String, books: [AssistantBookEntity]) {
    self.heading = heading
    self.books = books
  }

  func perform() async throws -> some IntentResult & ShowsSnippetView {
    .result {
      AssistantResultSnippet(heading: heading, books: books, interactive: true)
    }
  }
}
