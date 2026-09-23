import AppIntents

struct ResumeListeningIntent: AudioPlaybackIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Resume Listening"
  static var description = IntentDescription("Resumes your active LAABS Audio audiobook or episode.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  func perform() async throws -> some IntentResult {
    let outcome = await AssistantActionDispatcher.shared.perform(
      AssistantActionRequest(kind: .resume)
    )
    if case .failure(let code, _) = outcome, code == "nothingPlaying" || code == "signInRequired" {
      try await requestToContinueInForeground(
        code == "signInRequired"
          ? "Open LAABS Audio to choose a session."
          : "Open LAABS Audio to choose something to play."
      )
    }
    return try AssistantIntentSupport.finishPlaybackCommand(outcome)
  }
}
