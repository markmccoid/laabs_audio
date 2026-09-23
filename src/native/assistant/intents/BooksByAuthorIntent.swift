import AppIntents

struct BooksByAuthorIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Find Books by Author"
  static var description = IntentDescription(
    "Lists audiobooks by typing an author name. Kept so existing Shortcuts still run."
  )
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Author")
  var author: String

  static var parameterSummary: some ParameterSummary {
    Summary("Books by \(\.$author)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    try await presentLibrarySearch(AssistantLibrarySearchSupport.authorList(authorName: author))
  }
}

struct BooksByAuthorEntityIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Books by Author"
  static var description = IntentDescription("Lists audiobooks by a selected author in your LAABS Audio library.")
  static var openAppWhenRun = false
  static var isDiscoverable = false

  @Parameter(title: "Author")
  var author: AssistantAuthorEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Books by \(\.$author)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    try await presentLibrarySearch(AssistantLibrarySearchSupport.resolvedAuthor(entity: author))
  }
}
