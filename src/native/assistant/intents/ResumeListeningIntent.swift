import AppIntents

struct ResumeListeningIntent: AudioStartingIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Resume Listening"
  static var description = IntentDescription("Resumes your active LAABS Audio audiobook or episode.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let outcome = await AssistantActionDispatcher.shared.perform(
      AssistantActionRequest(kind: .resume)
    )
    switch outcome {
    case .playback(let title, _):
      return .result(dialog: "Resuming \(title).") {
        AssistantResultSnippet(heading: "Resuming \(title)", books: [])
      }
    case .failure(let code, _) where code == "nothingPlaying":
      try await requestToContinueInForeground(
        "Open LAABS Audio to choose something to play."
      )
      return .result(dialog: "Choose something to play in LAABS Audio.") {
        AssistantResultSnippet(heading: "Choose something to play", books: [])
      }
    case .failure(let code, _):
      if code == "signInRequired" {
        try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      }
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code)) {
        AssistantResultSnippet(heading: AssistantIntentSupport.failureHeading(code: code), books: [])
      }
    default:
      return .result(dialog: "LAABS Audio returned an unexpected playback result.") {
        AssistantResultSnippet(heading: "Playback failed", books: [])
      }
    }
  }
}
