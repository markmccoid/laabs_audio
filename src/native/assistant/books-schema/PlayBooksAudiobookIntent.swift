import AppIntents

@available(iOS 18.0, *)
@AppIntent(schema: .books.playAudiobook)
struct PlayBooksAudiobookIntent: ForegroundContinuableIntent {
  @Parameter(title: "Audiobook")
  var target: AssistantBooksAudiobookEntity

  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let row = AssistantCatalogReader.shared.book(byID: target.id) else {
      return response(.failure(code: "notFound", message: "Audiobook not found"))
    }

    switch AssistantAccessPolicy.canPlay(row, AssistantRuntimeContextStore.shared.current()) {
    case .allowed:
      return response(
        await AssistantActionDispatcher.shared.perform(
          AssistantActionRequest(kind: .play, libraryItemId: row.libraryItemId)
        )
      )
    case .signInRequired:
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      return response(.failure(code: "signInRequired", message: "Sign in required"))
    case .cannotStream:
      return response(.failure(code: "cannotStream", message: "Download required"))
    }
  }

  private func response(_ outcome: AssistantActionOutcome) -> some IntentResult & ProvidesDialog {
    switch outcome {
    case .playback(let title, _):
      let selection = target.matchedFromMany ? "I found several matches. " : ""
      return .result(dialog: "\(selection)Playing \(title).")
    case .failure(let code, _):
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code))
    default:
      return .result(dialog: "LAABS Audio couldn't complete that request.")
    }
  }
}
