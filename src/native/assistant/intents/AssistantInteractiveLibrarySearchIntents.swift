import AppIntents

@available(iOS 26.0, *)
struct SearchLibraryIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Search Audiobooks"
  static var description = IntentDescription("Searches your LAABS Audio library for audiobooks.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Search")
  var query: String

  static var parameterSummary: some ParameterSummary {
    Summary("Search \(\.$query) in my library")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
    try await presentInteractiveLibrarySearch(AssistantLibrarySearchSupport.textSearch(query: query))
  }
}

@available(iOS 26.0, *)
struct SearchBooksByAuthorNameIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Search by Author Name"
  static var description = IntentDescription("Lists audiobooks by typing an author name.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Author")
  var author: String

  static var parameterSummary: some ParameterSummary {
    Summary("Books by \(\.$author)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
    try await presentInteractiveLibrarySearch(
      AssistantLibrarySearchSupport.authorList(authorName: author)
    )
  }
}

@available(iOS 26.0, *)
struct SearchBooksByAuthorIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Search by Author"
  static var description = IntentDescription("Lists audiobooks by a selected author in your LAABS Audio library.")
  static var openAppWhenRun = false
  static var isDiscoverable = false

  @Parameter(title: "Author")
  var author: AssistantAuthorEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Books by \(\.$author)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
    try await presentInteractiveLibrarySearch(
      AssistantLibrarySearchSupport.resolvedAuthor(entity: author)
    )
  }
}
