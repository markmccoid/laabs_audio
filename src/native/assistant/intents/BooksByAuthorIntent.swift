import AppIntents

struct BooksByAuthorIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Books by Author"
  static var description = IntentDescription("Lists audiobooks by an author in your LAABS Audio library.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Author")
  var author: String

  static var parameterSummary: some ParameterSummary {
    Summary("Books by \(\.$author)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let context = AssistantRuntimeContextStore.shared.current()
    guard AssistantAccessPolicy.canAnswerReadOnly(context) else {
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      return .result(dialog: AssistantIntentSupport.failureDialog(code: "signInRequired")) {
        AssistantResultSnippet(heading: "Sign in required", books: [])
      }
    }

    let books = AssistantCatalogReader.shared.booksByAuthor(text: author, limit: 10)
      .map { AssistantBookEntity(row: $0) }
    guard !books.isEmpty else {
      return .result(dialog: "I couldn't find books by \(author) in your LAABS Audio library.") {
        AssistantResultSnippet(heading: "No books by \(author)", books: [])
      }
    }

    let spokenTitles = books.prefix(5).map(\.title).joined(separator: ", ")
    return .result(dialog: "You have \(books.count) books by \(author), including \(spokenTitles).") {
      AssistantResultSnippet(heading: "Books by \(author)", books: books)
    }
  }
}
