import AppIntents

struct AssistantShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .teal

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: PlayAudiobookIntent(),
      phrases: [
        "Play \(.applicationName)",
      ],
      shortTitle: "Play",
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
    if #available(iOS 26.0, *) {
      // Phrases must not start with "Search". That grammar belongs to system in-app
      // search ("Search <anything> in <app>"). A competing shortcut lets Siri treat
      // "books by" as "bookmark" and run BookmarkHereIntent instead.
      AppShortcut(
        intent: SearchLibraryIntent(),
        phrases: [
          "Find an audiobook in \(.applicationName)",
          "Look up a book in \(.applicationName)",
        ],
        shortTitle: "Find a Book",
        systemImageName: "magnifyingglass"
      )
      AppShortcut(
        intent: SearchBooksByAuthorNameIntent(),
        phrases: [
          "Find books by an author in \(.applicationName)",
          "What books by an author are in \(.applicationName)",
        ],
        shortTitle: "Find Books by Author",
        systemImageName: "person.text.rectangle"
      )
    }
    // Do not say "book" or "bookmark" here. Siri hears "books by" as "bookmark"
    // and runs this instead of author search.
    AppShortcut(
      intent: BookmarkHereIntent(),
      phrases: [
        "Save my place in \(.applicationName)",
        "Mark this position in \(.applicationName)",
      ],
      shortTitle: "Save My Place",
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
