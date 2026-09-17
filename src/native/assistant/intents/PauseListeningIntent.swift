import AppIntents

struct PauseListeningIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Pause Listening"
  static var description = IntentDescription("Pauses LAABS Audio playback.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let outcome = await AssistantActionDispatcher.shared.perform(
      AssistantActionRequest(kind: .pause)
    )
    switch outcome {
    case .paused:
      return .result(dialog: "Paused.") {
        AssistantResultSnippet(heading: "Paused", books: [])
      }
    case .failure(let code, _):
      if code == "signInRequired" {
        try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      }
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code)) {
        AssistantResultSnippet(heading: AssistantIntentSupport.failureHeading(code: code), books: [])
      }
    default:
      return .result(dialog: "LAABS Audio returned an unexpected pause result.") {
        AssistantResultSnippet(heading: "Pause failed", books: [])
      }
    }
  }
}
