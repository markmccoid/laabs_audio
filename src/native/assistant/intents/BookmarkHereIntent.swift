import AppIntents

struct BookmarkHereIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Bookmark Here"
  static var description = IntentDescription("Adds a bookmark at the current LAABS Audio position.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Bookmark Title")
  var bookmarkTitle: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Bookmark the current position")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let outcome = await AssistantActionDispatcher.shared.perform(
      AssistantActionRequest(kind: .bookmarkHere, title: bookmarkTitle)
    )
    switch outcome {
    case .bookmark(let title, let positionSeconds, _):
      let timestamp = AssistantIntentSupport.clock(positionSeconds)
      return .result(dialog: "Bookmarked \(title) at \(timestamp).") {
        AssistantResultSnippet(heading: "Bookmarked at \(timestamp)", books: [])
      }
    case .failure(let code, _):
      if code == "signInRequired" {
        try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      }
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code)) {
        AssistantResultSnippet(heading: AssistantIntentSupport.failureHeading(code: code), books: [])
      }
    default:
      return .result(dialog: "LAABS Audio returned an unexpected bookmark result.") {
        AssistantResultSnippet(heading: "Bookmark failed", books: [])
      }
    }
  }
}
