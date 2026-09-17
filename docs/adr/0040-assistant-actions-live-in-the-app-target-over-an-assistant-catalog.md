# Assistant Actions live in the app target and read an Assistant Catalog

Siri, Shortcuts, and Spotlight reach LAABS Audio through Apple's App Intents framework,
which the glossary names **Assistant Actions** (the word "intent" was already taken by Playback Control
Intent and Progress Sync Intent). The Swift for them is compiled into the **main app target** through the
existing `src/native` inline-module path — not into an extension created by `expo-apple-targets`. The
actions search an **Assistant Catalog**: a TypeScript-owned projection table with a frozen contract,
living in the same shadow SQLite database, rather than the `library_catalog_*` tables whose schema is
versioned for the app's own reads. The deployment target stays at 16.4: every supported release gets
App Shortcuts with a bounded parameter list, iOS 18–26 also get the `.books` audiobook schema, and the
`.audio` App Intents domain (`playAudio`, `AudioSearch`) is adopted behind `@available(iOS 27, *)`.
Control Center and Action-button controls are deferred until playback can be driven reliably when the
app process is not alive.

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
- **Raising the deployment target for schema adoption, or shipping only App Shortcuts.** Rejected both
  ways: the floor stays where the rest of the app needs it, while availability gates add the iOS 18
  `.books` schema and the iOS 27 `.audio` schema without excluding older devices. App Shortcuts can only
  recognise the ≤25 books LAABS suggests, so schema adoption remains necessary for free-text playback.

## Consequences

- A play command arriving while the app is not running cannot wait on the React Native runtime. Swift
  records a durable **Pending Assistant Action**; JavaScript drains it once startup is settled (the same
  gate that governs Startup Active Playback Restore) and reports completion, which Swift awaits with a
  timeout before answering Siri. A pending play *overrides* the never-auto-play rule of Startup Active
  Playback Restore because it is a user command, and becomes an ordinary Playback Start Attempt.
- The Assistant Catalog carries listening state (progress, finished, last played, downloaded,
  favourite) so ranking and Spotlight policy can be decided in Swift without a round trip to
  JavaScript. It physically contains only the chosen Audiobookshelf User Identity's projection, is
  rebuilt when `refreshActiveLibrary` completes, includes retained downloaded audiobooks whose server
  catalog rows are missing, and is patched incrementally as progress, favourites and downloads change;
  podcast Libraries are not projected.
- Because the actions run in the app process, they inherit the app's Access Mode rules rather than
  needing their own: read-only actions answer for the chosen User Session, play actions follow Download
  Availability and session rules, and explicit logout clears the projection and disables assistant
  surfaces until User Session Entry chooses an identity again.
- `expo-apple-targets` is not a dependency of this feature. Anyone adding it later for a different
  target should not move Assistant Actions into it without re-reading the first considered option.
