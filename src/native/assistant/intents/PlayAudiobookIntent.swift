import AppIntents

struct PlayAudiobookIntent: AudioPlaybackIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Play an Audiobook"
  static var description = IntentDescription("Plays an audiobook from your LAABS Audio library.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Audiobook")
  var book: AssistantBookEntity?

  init() {}

  init(book: AssistantBookEntity) {
    self.book = book
  }

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$book)")
  }

  func perform() async throws -> some IntentResult {
    guard let book else {
      let outcome = await AssistantActionDispatcher.shared.perform(
        AssistantActionRequest(kind: .resume)
      )
      try await continueIfNeeded(outcome)
      return try AssistantIntentSupport.finishPlaybackCommand(outcome)
    }

    let context = AssistantRuntimeContextStore.shared.current()
    guard let row = AssistantCatalogReader.shared.book(byID: book.id) else {
      throw AssistantSpokenFailure(AssistantIntentSupport.failureMessage(code: "notFound"))
    }

    switch AssistantAccessPolicy.canPlay(row, context) {
    case .signInRequired:
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      throw AssistantSpokenFailure(AssistantIntentSupport.failureMessage(code: "signInRequired"))
    case .cannotStream:
      throw AssistantSpokenFailure(AssistantIntentSupport.failureMessage(code: "cannotStream"))
    case .allowed:
      if await AssistantActionDispatcher.shared.runtimeIsReady() == false {
        try await requestToContinueInForeground("Open LAABS Audio to play this audiobook.")
      }
      let outcome = await AssistantActionDispatcher.shared.perform(
        AssistantActionRequest(kind: .play, libraryItemId: book.libraryItemId)
      )
      try await continueIfNeeded(outcome)
      return try AssistantIntentSupport.finishPlaybackCommand(outcome)
    }
  }

  private func continueIfNeeded(_ outcome: AssistantActionOutcome) async throws {
    if case .failure(let code, _) = outcome, code == "signInRequired" {
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
    }
  }
}
