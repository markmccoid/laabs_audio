import AppIntents

struct IsBookInLibraryIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Find an Audiobook"
  static var description = IntentDescription("Searches your LAABS Audio library for audiobooks.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Search")
  var query: String

  static var parameterSummary: some ParameterSummary {
    Summary("Search \(\.$query) in my library")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    try await presentLibrarySearch(AssistantLibrarySearchSupport.textSearch(query: query))
  }
}
