import AppIntents

struct PauseListeningIntent: AudioPlaybackIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Pause Listening"
  static var description = IntentDescription("Pauses LAABS Audio playback.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  func perform() async throws -> some IntentResult {
    let outcome = await AssistantActionDispatcher.shared.perform(
      AssistantActionRequest(kind: .pause)
    )
    if case .failure(let code, _) = outcome, code == "signInRequired" {
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
    }
    return try AssistantIntentSupport.finishPlaybackCommand(outcome)
  }
}
