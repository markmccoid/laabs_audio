import AppIntents

enum AssistantSleepTimerMode: String, AppEnum {
  case minutes
  case endOfChapter
  case endOfNextChapter
  case cancel

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Sleep Timer Mode")
  static var caseDisplayRepresentations: [AssistantSleepTimerMode: DisplayRepresentation] = [
    .minutes: "Minutes",
    .endOfChapter: "End of Chapter",
    .endOfNextChapter: "End of Next Chapter",
    .cancel: "Cancel",
  ]

  var bridgeValue: String {
    switch self {
    case .minutes: return "minutes"
    case .endOfChapter: return "end_of_chapter"
    case .endOfNextChapter: return "end_of_next_chapter"
    case .cancel: return "cancel"
    }
  }
}

struct SetSleepTimerIntent: AppIntent, ForegroundContinuableIntent {
  static var title: LocalizedStringResource = "Set Sleep Timer"
  static var description = IntentDescription("Sets or cancels the LAABS Audio sleep timer.")
  static var openAppWhenRun = false
  static var isDiscoverable = true

  @Parameter(title: "Mode")
  var mode: AssistantSleepTimerMode

  @Parameter(title: "Minutes", inclusiveRange: (1, 360))
  var minutes: Int?

  static var parameterSummary: some ParameterSummary {
    Summary("Set sleep timer to \(\.$mode)")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let outcome = await AssistantActionDispatcher.shared.perform(
      AssistantActionRequest(
        kind: .sleepTimer,
        mode: mode.bridgeValue,
        minutes: minutes
      )
    )
    switch outcome {
    case .sleepTimer(let description):
      return .result(dialog: "\(description)") {
        AssistantResultSnippet(heading: description, books: [])
      }
    case .failure(let code, _):
      if code == "signInRequired" {
        try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      }
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code)) {
        AssistantResultSnippet(heading: AssistantIntentSupport.failureHeading(code: code), books: [])
      }
    default:
      return .result(dialog: "LAABS Audio returned an unexpected sleep timer result.") {
        AssistantResultSnippet(heading: "Sleep timer failed", books: [])
      }
    }
  }
}
