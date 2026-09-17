import AppIntents

struct AssistantSpikeIntent: AudioStartingIntent {
  static var title: LocalizedStringResource = "LAABS Playback Spike"
  static var description = IntentDescription(
    "Resumes the most recent LAABS Audio playback through the React Native bridge."
  )
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let request = AssistantActionRequest(
      id: UUID().uuidString,
      kind: .resume
    )
    let outcome = await AssistantActionDispatcher.shared.perform(request)

    switch outcome {
    case .success:
      return .result(dialog: "LAABS playback spike completed.")
    case .failure(let code, _):
      switch code {
      case "nothingPlaying":
        return .result(dialog: "Open LAABS Audio and play an audiobook first.")
      case "busy":
        return .result(dialog: "LAABS Audio is already handling another request.")
      case "timeout":
        return .result(dialog: "LAABS Audio could not start playback in time. Open the app to continue.")
      default:
        return .result(dialog: "LAABS Audio could not complete the playback spike.")
      }
    }
  }
}

struct AssistantSpikeShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .teal

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: AssistantSpikeIntent(),
      phrases: ["Run the playback spike in \(.applicationName)"],
      shortTitle: "Playback Spike",
      systemImageName: "bolt.fill"
    )
  }
}
