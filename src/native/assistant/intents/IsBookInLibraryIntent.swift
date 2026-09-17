import AppIntents

struct IsBookInLibraryIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Find an Audiobook"
  static var description = IntentDescription("Checks your LAABS Audio library for an audiobook.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Title")
  var query: String

  static var parameterSummary: some ParameterSummary {
    Summary("Find \(\.$query) in my library")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let context = AssistantRuntimeContextStore.shared.current()
    guard AssistantAccessPolicy.canAnswerReadOnly(context) else {
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      return .result(dialog: AssistantIntentSupport.failureDialog(code: "signInRequired")) {
        AssistantResultSnippet(heading: "Sign in required", books: [])
      }
    }

    let matches = AssistantCatalogReader.shared.search(text: query, limit: 5)
      .map { AssistantBookEntity(row: $0) }
    guard let first = matches.first else {
      return .result(dialog: "I couldn't find \(query) in your LAABS Audio library.") {
        AssistantResultSnippet(heading: "No matching audiobook", books: [])
      }
    }

    let percent = Int((first.progressPercent * 100).rounded())
    let author = first.author.map { " by \($0)" } ?? ""
    let downloaded = first.isDownloaded ? ", downloaded" : ""
    return .result(dialog: "Yes — \(first.title)\(author), \(percent) percent listened\(downloaded).") {
      AssistantResultSnippet(heading: "Found in LAABS Audio", books: matches)
    }
  }
}
