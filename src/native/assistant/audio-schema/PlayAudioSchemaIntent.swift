import AppIntents

@available(iOS 27.0, *)
@AppEnum(schema: .audio.playbackAttributes)
enum AssistantPlaybackAttribute: String {
  case shuffle
  case `repeat`

  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .shuffle: "Shuffle",
    .repeat: "Repeat",
  ]
}

@available(iOS 27.0, *)
@AppEnum(schema: .audio.queueInsertionLocation)
enum AssistantQueueInsertionLocation: String {
  case next
  case tail

  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .next: "Next",
    .tail: "End of Queue",
  ]
}

@available(iOS 27.0, *)
@AppEntity(schema: .audio.warmupAudioQueueResult)
struct AssistantWarmupAudioQueueResult: Identifiable {
  let id: String

  static var defaultQuery = AssistantWarmupAudioQueueResultQuery()
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Prepared Queue")

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "Prepared audiobook queue")
  }
}

@available(iOS 27.0, *)
struct AssistantWarmupAudioQueueResultQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [AssistantWarmupAudioQueueResult] {
    identifiers.map(AssistantWarmupAudioQueueResult.init)
  }

  func entities(matching string: String) async throws -> [AssistantWarmupAudioQueueResult] {
    []
  }

  func suggestedEntities() async throws -> [AssistantWarmupAudioQueueResult] {
    []
  }
}

@available(iOS 27.0, *)
@AppIntent(schema: .audio.playAudio)
struct PlayAudioSchemaIntent: AudioPlaybackIntent, ForegroundContinuableIntent {
  var audioEntity: AssistantAudioEntity
  var playbackAttributes: Set<AssistantPlaybackAttribute>
  var warmupAudioQueueResult: AssistantWarmupAudioQueueResult?
  var queueLocation: AssistantQueueInsertionLocation?

  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let audiobook: AssistantAudioAudiobookEntity
    switch audioEntity {
    case .audiobook(let value):
      audiobook = value
    }

    if audiobook.shouldResume {
      let outcome = await AssistantActionDispatcher.shared.perform(
        AssistantActionRequest(kind: .resume)
      )
      if case .failure(let code, _) = outcome, code == "signInRequired" {
        try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      }
      return response(outcome)
    }

    guard let row = AssistantCatalogReader.shared.book(byID: audiobook.id) else {
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
      if case .audiobook(let audiobook) = audioEntity, audiobook.shouldResume {
        return .result(dialog: "Resuming \(title).")
      }
      return .result(dialog: "Playing \(title).")
    case .failure(let code, _):
      return .result(dialog: AssistantIntentSupport.failureDialog(code: code))
    default:
      return .result(dialog: "LAABS Audio couldn't complete that request.")
    }
  }
}
