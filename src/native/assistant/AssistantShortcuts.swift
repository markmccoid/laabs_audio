import AppIntents

struct AssistantShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .teal

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: PlayAudiobookIntent(),
      phrases: [
        "Play \(\.$book) in \(.applicationName)",
        "Listen to \(\.$book) in \(.applicationName)",
        "Play \(.applicationName)",
      ],
      shortTitle: "Play a Book",
      systemImageName: "play.fill"
    )
    AppShortcut(
      intent: ResumeListeningIntent(),
      phrases: [
        "Resume \(.applicationName)",
        "Continue listening in \(.applicationName)",
        "Resume my book in \(.applicationName)",
      ],
      shortTitle: "Resume",
      systemImageName: "play.circle"
    )
    AppShortcut(
      intent: PauseListeningIntent(),
      phrases: ["Pause \(.applicationName)"],
      shortTitle: "Pause",
      systemImageName: "pause.fill"
    )
    AppShortcut(
      intent: IsBookInLibraryIntent(),
      phrases: [
        "Search my library in \(.applicationName)",
        "Find an audiobook in \(.applicationName)",
      ],
      shortTitle: "Find a Book",
      systemImageName: "magnifyingglass"
    )
    AppShortcut(
      intent: BooksByAuthorIntent(),
      phrases: ["Find books by an author in \(.applicationName)"],
      shortTitle: "Books by Author",
      systemImageName: "person.crop.rectangle.stack"
    )
    AppShortcut(
      intent: BookmarkHereIntent(),
      phrases: [
        "Bookmark this in \(.applicationName)",
        "Add a bookmark in \(.applicationName)",
      ],
      shortTitle: "Bookmark Here",
      systemImageName: "bookmark.fill"
    )
    AppShortcut(
      intent: SetSleepTimerIntent(),
      phrases: [
        "Set a sleep timer in \(.applicationName)",
        "Sleep timer \(.applicationName)",
      ],
      shortTitle: "Sleep Timer",
      systemImageName: "moon.zzz.fill"
    )
  }
}
