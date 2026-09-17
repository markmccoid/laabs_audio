# Assistant Actions live in the app target and read an Assistant Catalog

Siri, Shortcuts, Spotlight and Control Center reach LAABS Audio through Apple's App Intents framework,
which the glossary names **Assistant Actions** (the word "intent" was already taken by Playback Control
Intent and Progress Sync Intent). The Swift for them is compiled into the **main app target** through the
existing `src/native` inline-module path — not into an extension created by `expo-apple-targets`. The
actions search an **Assistant Catalog**: a TypeScript-owned projection table with a frozen contract,
living in the same shadow SQLite database, rather than the `library_catalog_*` tables whose schema is
versioned for the app's own reads. The `.audio` App Intents domain (`playAudio`, `AudioSearch`) is
adopted behind `@available(iOS 26)` while the deployment target stays at 16.4; iOS 16.4–25 get the same
actions through App Shortcuts with a bounded parameter list.

## Considered Options

- **An `app-intent` extension via `expo-apple-targets`, as the user first proposed.** Rejected as the
  home for these actions: an App Intents extension is out-of-process, so it can neither host the
  `AppShortcutsProvider` (which Apple requires in the app target) nor reach the running
  `react-native-audio-pro` player that `player-service.ts` drives. It would also force the catalog into
  the App Group container and duplicate every entity definition across two targets. Kept in reserve
  only if cold-launch latency on read-only queries proves unacceptable — the Assistant Catalog is a
  single table precisely so it can be moved there later.
- **Migrating the widget from `expo-widgets` to `expo-apple-targets` "so all targets share one
  mechanism".** Rejected: with no extension target in this design there is nothing to unify with, and
  the SDK 56 widget is stable.
- **Swift reading `library_catalog_items` / `library_catalog_fts` directly.** Rejected: it couples Swift
  to a schema (`SCHEMA_VERSION = 8`) that TypeScript migrates freely. A projection with its own contract
  costs one table and buys independence.
- **A JSON/plist snapshot in the App Group, as the widget does.** Rejected: fine for one Player Display,
  wrong for a multi-thousand-book library that needs ranked text search.
- **Raising the deployment target to 26 for the `.audio` schema, or skipping the schema and shipping
  only App Shortcuts.** Rejected both ways: the floor stays where the rest of the app needs it, and the
  schema is the only route to free-text "play *any* book" and to Apple Intelligence Siri. App Shortcuts
  can only recognise the ≤25 books LAABS suggests, so both are needed.

## Consequences

- A play command arriving while the app is not running cannot wait on the React Native runtime. Swift
  records a durable **Pending Assistant Action**; JavaScript drains it once startup is settled (the same
  gate that governs Startup Active Playback Restore) and reports completion, which Swift awaits with a
  timeout before answering Siri. A pending play *overrides* the never-auto-play rule of Startup Active
  Playback Restore because it is a user command, and becomes an ordinary Playback Start Attempt.
- The Assistant Catalog carries listening state (progress, finished, last played, downloaded,
  favourite) so ranking, Spotlight and Downloaded-Only Mode policy can be decided in Swift without a
  round trip to JavaScript. It is rebuilt when `refreshActiveLibrary` completes and patched
  incrementally as progress, favourites and downloads change; podcast Libraries are not projected.
- Because the actions run in the app process, they inherit the app's Access Mode rules rather than
  needing their own: read-only actions answer whenever a Listening State Owner is known, play actions
  follow Download Availability and session rules, and Signed-Out Required Sign-In sends the user to
  the app.
- `expo-apple-targets` is not a dependency of this feature. Anyone adding it later for a different
  target should not move Assistant Actions into it without re-reading the first considered option.
