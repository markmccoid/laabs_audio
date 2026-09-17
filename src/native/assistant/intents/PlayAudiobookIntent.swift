import AppIntents

struct PlayAudiobookIntent: AudioStartingIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Play an Audiobook"
  static var description = IntentDescription("Plays an audiobook from your LAABS Audio library.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Audiobook")
  var book: AssistantBookEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Play \(\.$book)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    guard let book else {
      let outcome = await AssistantActionDispatcher.shared.perform(
        AssistantActionRequest(kind: .resume)
      )
      if case .failure(let code, _) = outcome, code == "signInRequired" {
        try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      }
      return result(outcome: outcome, book: nil)
    }

    let context = AssistantRuntimeContextStore.shared.current()
    guard let row = AssistantCatalogReader.shared.book(byID: book.id) else {
      return result(
        outcome: .failure(code: "notFound", message: "Audiobook not found"),
        book: book
      )
    }

    switch AssistantAccessPolicy.canPlay(row, context) {
    case .signInRequired:
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      return result(
        outcome: .failure(code: "signInRequired", message: "Sign in required"),
        book: book
      )
    case .cannotStream:
      return result(
        outcome: .failure(code: "cannotStream", message: "Download required"),
        book: book
      )
    case .allowed:
      let outcome = await AssistantActionDispatcher.shared.perform(
        AssistantActionRequest(kind: .play, libraryItemId: book.libraryItemId)
      )
      return result(outcome: outcome, book: book)
    }
  }

  private func result(
    outcome: AssistantActionOutcome,
    book: AssistantBookEntity?
  ) -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    switch outcome {
    case .playback(let title, _):
      let author = book?.author.map { " by \($0)" } ?? ""
      let selection = book?.matchedFromMany == true ? "I found several matches. " : ""
      return .result(dialog: "\(selection)Playing \(title)\(author).") {
        AssistantResultSnippet(heading: "Now playing", books: book.map { [$0] } ?? [])
      }
    case .failure(let code, _):
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code)) {
        AssistantResultSnippet(
          heading: AssistantIntentSupport.failureHeading(code: code),
          books: book.map { [$0] } ?? []
        )
      }
    default:
      return .result(dialog: "LAABS Audio returned an unexpected playback result.") {
        AssistantResultSnippet(heading: "Playback failed", books: book.map { [$0] } ?? [])
      }
    }
  }
}
