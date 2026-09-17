# Assistant Actions (Siri / Shortcuts / Spotlight / Control Center) — Implementation Plan

Status: approved design, ready to build.
Design authority: `CONTEXT.md` ("Assistant surfaces" cluster and its relationships) and
`docs/adr/0040-assistant-actions-live-in-the-app-target-over-an-assistant-catalog.md`. If this plan
and those files disagree, those files win. Vocabulary in this document is the glossary's: an
**Assistant Action** is what Apple calls an App Intent; an **Assistant Book** is the `AppEntity`; the
**Assistant Catalog** is the table Swift reads; a **Pending Assistant Action** is a play/resume command
parked until the JS runtime is up.

## Settled decisions (do not relitigate)

| Decision | Choice |
|---|---|
| Swift placement | Main app target, `src/native/assistant/`, compiled by the existing inline-module path (`Podfile.properties.json` → `expo.inlineModules.watchedDirectories: ["src/native"]`). **No `expo-apple-targets`, no extension target.** |
| Widget | Untouched. Stays on `expo-widgets`. |
| iOS floor | Stays `16.4`. App Shortcuts everywhere; `.audio` schema + `AudioSearch` behind `@available(iOS 26, *)`; `IndexedEntity` and `ControlWidget` behind `@available(iOS 18, *)`. |
| Catalog access | Swift reads only `assistant_catalog` (a TS-owned projection table in `laabs-shadow-library.db`). Never `library_catalog_*`, `user_server_progress`, or `user_favorites`. |
| Scope | Current Audiobookshelf User Identity, **all** its audiobook Libraries that have been cached. No podcasts/episodes in the catalog. |
| v1 actions | Play ⟨book⟩, Resume, Pause, Is ⟨book⟩ in my library, Books by ⟨author⟩, Bookmark here, Sleep timer (minutes / end of chapter / end of next chapter / cancel). |
| Play semantics | Ordinary Playback Start Attempt (`playerService.loadBook(id, { autoPlay: true })`). ≤3 matches → Siri disambiguation; more → best title match, stated in reply. No spoken title → Resume. |
| Cold launch | Pending Assistant Action in Swift memory + `UserDefaults`; JS drains at the `warmupEligible` gate; Swift waits ≤10 s then fails with "Open LAABS Audio". A pending play overrides Startup Active Playback Restore's never-auto-play rule. |
| Bookmark title | Spoken title if given, else `"<Chapter title> · h:mm:ss"` (or `"Bookmark · h:mm:ss"` with no chapters). Never empty. Allowed for Episodes. |
| Reply style | Spoken dialog + SwiftUI snippet card (cover, title, author, progress). Lists: speak ≤5, show all returned (cap 10). |
| Spotlight | `IndexedEntity` mirror of the catalog; tap → `laabsaudio:///<libraryItemId>` (detail only, no playback). Downloaded-Only Mode indexes downloaded books only. Explicit logout clears the index. |
| Control Center / Action button | One `ControlWidget` toggle: Play/Pause of Active Playback, shows Player Display title; nothing to resume → opens app. |
| Language | English only. |

## Architecture at a glance

```
 Siri / Shortcuts / Spotlight / Control Center
                │  (App Intents framework, in-process)
                ▼
 src/native/assistant/*.swift  ── AssistantCatalogReader ──► laabs-shadow-library.db : assistant_catalog (read-only, libsqlite3)
                │
                │ AssistantBridge (Expo Module): events + promises + pending-action slot
                ▼
 src/assistant/*.ts ── handlers ──► playerService / deviceBooksStore / sleepTimerStore
                ▲
 src/data/sqlite/assistant-catalog-writes.ts ◄── refreshActiveLibrary, overlay/progress/favorite/download writes
```

Two process states matter:

- **JS alive** (app foreground or background-audio): Swift `perform()` calls `AssistantBridge` → emits `onAssistantAction` → TS handler runs → TS calls `AssistantBridge.completeAction(id, result)` → Swift continuation resumes → reply.
- **JS not alive** (cold launch in background by the system to run the intent): Swift parks a Pending Assistant Action, RN boots in parallel, `_layout.tsx` drains it at `warmupEligible`, same completion path. Read-only actions never touch JS at all.

---

## Phase 0 — Spike: App Intents metadata under the inline-module build (gate for everything else)

Apple's `appintentsmetadataprocessor` must see the intents in the **app target**. Inline modules compile `src/native/**/*.swift` into `LAABSAudiobookshelf`, which is what we need — but prove it before writing real code.

1. Create `src/native/assistant/AssistantSpikeIntent.swift`:
   ```swift
   import AppIntents

   struct AssistantSpikeIntent: AppIntent {
     static var title: LocalizedStringResource = "LAABS Spike"
     static var openAppWhenRun = false
     func perform() async throws -> some IntentResult & ProvidesDialog {
       .result(dialog: "LAABS spike OK")
     }
   }

   struct AssistantSpikeShortcuts: AppShortcutsProvider {
     static var appShortcuts: [AppShortcut] {
       AppShortcut(intent: AssistantSpikeIntent(), phrases: ["Run the spike in \(.applicationName)"],
                   shortTitle: "Spike", systemImageName: "bolt")
     }
   }
   ```
2. `npx expo prebuild --clean -p ios && npx expo run:ios --device` (App Intents are only reliable on a device).
3. Verify: build log contains `appintentsmetadataprocessor` with no "metadata extraction skipped" warning; `LAABS Audiobookshelf.app/Metadata.appintents/` exists; the Shortcuts app shows "Spike" under the LAABS app; saying "Run the spike in LAABS Audiobookshelf" answers.
4. If extraction fails: check the target's `Other Swift Flags` / that the files are in the main target's compile sources (not a pod). Fallback (only if needed): a small config plugin `plugins/with-assistant-sources.js` using `withXcodeProject` to add `src/native/assistant` as a synchronized group — but the inline-module path should already do this.
5. Delete the spike files once Phase 4 lands.

**Exit criterion:** phrase works on device from a cold app (force-quit first).

---

## Phase 1 — Assistant Catalog (TypeScript, SQLite)

### 1.1 Schema — `src/data/sqlite/shadow-db-core.ts`

Bump `SCHEMA_VERSION` to 9 and add (idempotent `CREATE TABLE IF NOT EXISTS`, following the existing migration pattern in that file):

```sql
CREATE TABLE IF NOT EXISTS assistant_catalog (
  user_id            TEXT    NOT NULL,   -- Audiobookshelf User Identity (same value as library_catalog_items.user_id)
  library_item_id    TEXT    NOT NULL,
  library_id         TEXT    NOT NULL,
  server_id          TEXT    NOT NULL,   -- stable server identity used in the entity id (see 1.4)
  title              TEXT    NOT NULL,
  subtitle           TEXT,
  author             TEXT,
  narrator           TEXT,
  series_name        TEXT,
  series_sequence    TEXT,
  duration_seconds   REAL    NOT NULL DEFAULT 0,
  cover_path         TEXT,               -- absolute local file path when cached (widget artwork cache), else NULL
  cover_url          TEXT,               -- server cover URL (fallback for snippet when online)
  search_text        TEXT    NOT NULL,   -- normalized: lower, diacritics stripped, punctuation → space, collapsed
  title_normalized   TEXT    NOT NULL,
  author_normalized  TEXT    NOT NULL DEFAULT '',
  series_normalized  TEXT    NOT NULL DEFAULT '',
  narrator_normalized TEXT   NOT NULL DEFAULT '',
  progress_percent   REAL    NOT NULL DEFAULT 0,   -- 0..1
  current_time_seconds REAL  NOT NULL DEFAULT 0,
  is_finished        INTEGER NOT NULL DEFAULT 0,
  last_played_at     INTEGER,            -- ms epoch; NULL when never played
  is_downloaded      INTEGER NOT NULL DEFAULT 0,
  is_favorite        INTEGER NOT NULL DEFAULT 0,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, library_item_id)
);
CREATE INDEX IF NOT EXISTS idx_assistant_catalog_user_search ON assistant_catalog(user_id, search_text);
CREATE INDEX IF NOT EXISTS idx_assistant_catalog_user_recent ON assistant_catalog(user_id, last_played_at DESC);

CREATE TABLE IF NOT EXISTS assistant_catalog_meta (
  user_id     TEXT PRIMARY KEY NOT NULL,
  built_at    INTEGER NOT NULL,
  row_count   INTEGER NOT NULL,
  contract_version INTEGER NOT NULL      -- start at 1; Swift refuses to read a version it does not know
);
```

Deliberately **no FTS** table: Swift reads with the system `libsqlite3` and must not depend on the FTS5 build that ships in expo-sqlite. Ranking is done in Swift over `*_normalized` columns (a few thousand rows is trivial).

### 1.2 Normalizer — `src/assistant/assistant-text.ts` (shared with a Swift twin)

`normalizeAssistantText(value: string): string` — NFD, strip combining marks, lowercase, replace `[^a-z0-9]+` with a single space, trim. Add `assistant-text.test.ts` with fixtures ("The Shining" → `the shining`, "Dune: Messiah" → `dune messiah`, "Stephen King" → `stephen king`, "Björk" → `bjork`). The Swift `AssistantText.normalize` in Phase 3 must produce byte-identical output for the same fixtures — put the fixtures in a JSON file both test suites read (`src/assistant/__fixtures__/normalize-fixtures.json`).

### 1.3 Writer — `src/data/sqlite/assistant-catalog-writes.ts`

```ts
export const rebuildAssistantCatalog = (scope: { userId: string }): Promise<{ rowCount: number }>;
export const patchAssistantCatalogProgress = (userId: string, libraryItemId: string, patch: {
  progressPercent: number; currentTimeSeconds: number; isFinished: boolean; lastPlayedAt?: number;
}): Promise<void>;
export const patchAssistantCatalogFavorite = (userId: string, libraryItemId: string, isFavorite: boolean): Promise<void>;
export const patchAssistantCatalogDownloaded = (userId: string, libraryItemId: string, isDownloaded: boolean): Promise<void>;
export const clearAssistantCatalog = (userId?: string): Promise<void>; // undefined = all users
```

`rebuildAssistantCatalog`:
- Runs under `withWriteGuard` + `runInTransaction`.
- Source rows: `library_catalog_items` joined to `libraries` where `libraries.media_type = 'book'` (audiobook libraries only) and `is_missing = 0`, for `user_id = scope.userId`. Left-join `user_server_progress`, `user_favorites`. Downloaded flag from `deviceBooksStore` (pass a `Set<string>` of downloaded library item ids in; do not import the store into the SQLite layer — accept it as a parameter and let the caller supply it).
- `series_sequence` and `subtitle` come from `summary_json` if present.
- `cover_path`: resolve through `resolveCachedWidgetArtworkUri` when a cached file exists; otherwise NULL. (Do not trigger downloads here; the snippet falls back to `cover_url` or a placeholder.)
- `server_id`: derive once via `getAssistantServerId()` in `src/assistant/assistant-identity.ts` — the hostname of the current Server Connection Endpoint, lowercased, port included. Keep it a function so it can be swapped for a server UUID later without touching the writer.
- `DELETE FROM assistant_catalog WHERE user_id = ?` then bulk insert in chunks of 500; then upsert `assistant_catalog_meta`.
- Emits `assistantCatalogChanged` on a tiny event emitter (`src/assistant/assistant-catalog-events.ts`) so Phase 5/7 can react (Suggested Assistant Books refresh, Spotlight reindex).

### 1.4 Assistant Book identity

Entity id string: `${server_id}|${library_item_id}`. Helpers in `src/assistant/assistant-identity.ts` (TS) and `AssistantBookID` (Swift): `parse`, `format`. Both sides reject ids without exactly one `|`.

### 1.5 Hook points

| Where | Call |
|---|---|
| `refresh-coordinator.ts` → `refreshActiveLibrary`, immediately before `invalidateSqliteQueries(...)` | `await rebuildAssistantCatalog({ userId: scope.userId })` when catalog **or** overlay refreshed. Wrap in try/catch + `recordTimingLog("assistant", "catalog_rebuild", …)`; a failure must never fail the library refresh. |
| `overlay-writes.ts` → `upsertShadowServerProgressProjection` | after the write: `patchAssistantCatalogProgress(...)`, passing `lastPlayedAt: Date.now()` only when called from `player-service.ts` (add an optional flag to the existing function rather than a second call site). |
| `overlay-writes.ts` → `setShadowFavoriteProjection` | `patchAssistantCatalogFavorite(...)`. |
| `device-books-store.ts` download completed / removed | `patchAssistantCatalogDownloaded(...)`. Locate the transitions to `status: "completed"` (≈ L3721) and the remove-download action. |
| Session Entry Switch (`src/auth/user-session-entry*.ts`) | after the new session commits: `rebuildAssistantCatalog({ userId: newUserId })` if that user has cached libraries; the old user's rows stay (they are scoped by `user_id`) — Swift only ever reads the *current* user. |
| Explicit logout | `clearAssistantCatalog(userId)` **and** `AssistantBridge.clearSpotlightIndex()` (Phase 7). |

### 1.6 Telling Swift where the DB is and who the user is

Swift must not guess the expo-sqlite directory. At startup (`_layout.tsx`, next to `playerService.init()`), and again on any Session Entry Switch / logout / Access Mode change, JS calls:

```ts
AssistantBridge.publishRuntimeContext({
  dbPath: `${SQLite.defaultDatabaseDirectory}/laabs-shadow-library.db`,
  userId: activeLibraryUserKey ?? null,
  accessMode: "signedIn" | "sessionNeedsSignIn" | "offlineSession" | "downloadedOnly" | "signedOutRequired",
  canStream: boolean,          // signed in or offline-remembered session
  serverId: getAssistantServerId() ?? null,
});
```

The bridge persists this in `UserDefaults.standard` under `laabs.assistant.runtimeContext` so a cold-launched intent has it before JS is up. Create `src/assistant/assistant-runtime-context.ts` to compute it from `authStore` / access-mode selectors, and subscribe so republishing is automatic.

### 1.7 Tests

- `assistant-catalog-writes.test.ts`: rebuild picks only `media_type = 'book'` libraries; progress/favorite/downloaded joins; patch functions are no-ops for unknown rows; `clearAssistantCatalog` scoping.
- Normalizer fixtures (1.2).

---

## Phase 2 — `AssistantBridge` Expo module (Swift ⇄ TS)

### 2.1 Files

```
src/native/assistant/
  AssistantBridge.swift              // Expo Module: events, functions, pending-action slot
  AssistantActionDispatcher.swift    // singleton the intents call; owns continuations
  AssistantRuntimeContext.swift      // Codable mirror of 1.6, UserDefaults-backed
  AssistantBridgeModule.ts           // requireNativeModule typing
  AssistantBridgeModule.web.ts       // no-op stub (matches sibling modules)
  AssistantBridge.types.ts
  index.ts
```

### 2.2 Action payloads (`AssistantBridge.types.ts` and Swift `Codable` twins)

```ts
export type AssistantActionRequest =
  | { id: string; kind: "play"; libraryItemId: string }
  | { id: string; kind: "resume" }
  | { id: string; kind: "pause" }
  | { id: string; kind: "bookmarkHere"; title: string | null }
  | { id: string; kind: "sleepTimer"; mode: "minutes" | "end_of_chapter" | "end_of_next_chapter" | "cancel"; minutes: number | null }
  | { id: string; kind: "togglePlayPause" };            // Control Center

export type AssistantActionResult =
  | { ok: true; kind: "play" | "resume" | "togglePlayPause"; libraryItemId: string; title: string; isPlaying: boolean }
  | { ok: true; kind: "pause" }
  | { ok: true; kind: "bookmarkHere"; title: string; positionSeconds: number; bookTitle: string }
  | { ok: true; kind: "sleepTimer"; description: string }
  | { ok: false; code: "nothingPlaying" | "signInRequired" | "cannotStream" | "notFound" | "playbackFailed" | "timeout" | "unsupported"; message: string };
```

Exhaustive `switch` with a `never` default on `kind` in every TS handler.

### 2.3 Swift API (`AssistantActionDispatcher`)

```swift
final class AssistantActionDispatcher {
  static let shared = AssistantActionDispatcher()
  var isRuntimeReady: Bool               // set true by JS `markRuntimeReady()` at warmupEligible; false on module teardown
  func perform(_ request: AssistantActionRequest, timeout: Duration = .seconds(10)) async -> AssistantActionResult
  func takePendingAction() -> AssistantActionRequest?      // JS drain
  func complete(id: String, result: AssistantActionResult) // JS → Swift
}
```

`perform`:
1. Store `CheckedContinuation` under `request.id`.
2. If `isRuntimeReady` → `sendEvent("onAssistantAction", request)`.
   Else → write request to `pendingSlot` (memory) **and** `UserDefaults` key `laabs.assistant.pendingAction` (survives the unlikely case that the module instance is recreated during RN boot).
3. Race the continuation against the timeout; on timeout remove continuation, clear the slot, return `.failure(code: "timeout")`.

Only `play`, `resume`, `togglePlayPause` may be parked as Pending Assistant Actions. `pause`, `bookmarkHere`, `sleepTimer` with `isRuntimeReady == false` return `nothingPlaying` immediately (there is no audible playback if the process was not alive).

### 2.4 Expo module surface (`AssistantBridge.swift`)

```
Name("AssistantBridge")
Events("onAssistantAction")
Function("publishRuntimeContext") { (ctx: [String: Any]) }          // 1.6
Function("markRuntimeReady")                                          // JS at warmupEligible
Function("takePendingAction") -> [String: Any]?                        // JS drain
Function("completeAction") { (id: String, result: [String: Any]) }
AsyncFunction("refreshSuggestedBooks")                                 // Phase 5: AppShortcutsProvider.updateAppShortcutParameters()
AsyncFunction("reindexSpotlight") { (userId: String?) }                // Phase 7
AsyncFunction("clearSpotlightIndex")                                  // Phase 7
Function("reloadControls")                                             // Phase 8: ControlCenter.shared.reloadAllControls()
OnDestroy { AssistantActionDispatcher.shared.isRuntimeReady = false }
```

### 2.5 TS side (`src/assistant/assistant-bridge.ts`)

- `startAssistantActionListener(handler: (req) => Promise<AssistantActionResult>)`: subscribes to `onAssistantAction`, and drains `takePendingAction()` once — call from `_layout.tsx` inside the `warmupEligible` effect **before** the Startup Active Playback Restore effect body runs, and if a pending `play`/`resume` exists set a ref `startupAssistantOwnsPlaybackRef = true` that the restore effect checks and bails on (this is the "pending play overrides never-auto-play" rule).
- Every handler must `completeAction(id, result)` in a `finally`.

---

## Phase 3 — Assistant Book entity & catalog reader (Swift)

### 3.1 `AssistantCatalogReader.swift`

- `import SQLite3`; open `runtimeContext.dbPath` with `SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX`; WAL readers need no extra setup. Check `assistant_catalog_meta.contract_version == 1` for the user; otherwise treat as empty and log.
- Queries (all filtered by `user_id = runtimeContext.userId`):
  - `book(byLibraryItemId:)`
  - `search(text:, limit:) -> [AssistantBookRow]` — normalize input (Swift twin of 1.2), then rank in memory over rows where `search_text LIKE '%' || ? || '%'`:
    1. `title_normalized == q` → 100
    2. `title_normalized` hasPrefix q → 80
    3. `title_normalized` contains q → 60
    4. `series_normalized` contains q → 50
    5. `author_normalized` contains q → 40
    6. `narrator_normalized` contains q → 30
    Tie-break: in-progress first, then `last_played_at DESC`, then title.
  - `booksByAuthor(text:, limit:)` — `author_normalized LIKE`.
  - `suggested(limit: 25)` — `ORDER BY (progress_percent > 0 AND is_finished = 0) DESC, is_downloaded DESC, is_favorite DESC, last_played_at DESC`.
  - `mostRecent()` — `ORDER BY last_played_at DESC LIMIT 1` where `last_played_at IS NOT NULL`.
  - `downloadedOnly` variants when `accessMode == "downloadedOnly"` (append `AND is_downloaded = 1`).
- All reads on a serial `DispatchQueue`; the connection is opened lazily and reopened if `dbPath` changes.

### 3.2 `AssistantBookEntity.swift`

```swift
struct AssistantBookEntity: AppEntity, Identifiable {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audiobook")
  static var defaultQuery = AssistantBookQuery()
  var id: String                      // "server|libraryItemId"
  @Property(title: "Title")  var title: String
  @Property(title: "Author") var author: String?
  @Property(title: "Narrator") var narrator: String?
  @Property(title: "Series") var series: String?
  @Property(title: "Progress") var progressPercent: Double
  @Property(title: "Finished") var isFinished: Bool
  @Property(title: "Downloaded") var isDownloaded: Bool
  var libraryItemId: String
  var coverPath: String?
  var displayRepresentation: DisplayRepresentation  // title, subtitle "by Author · 43%", image from coverPath if present
}

struct AssistantBookQuery: EntityQuery, EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [AssistantBookEntity]
  func entities(matching string: String) async throws -> [AssistantBookEntity]   // reader.search(limit: 10)
  func suggestedEntities() async throws -> [AssistantBookEntity]                   // reader.suggested(25)
}
```

On iOS 26 (Phase 6) the entity additionally conforms to `@AssistantEntity(schema: .audio.audiobook)`; keep the base struct schema-free so 16.4 builds compile.

---

## Phase 4 — v1 intents, App Shortcuts, replies (Swift)

### 4.1 Access-mode guard — `AssistantAccessPolicy.swift`

```swift
enum AssistantAccessPolicy {
  static func canAnswerReadOnly(_ ctx: AssistantRuntimeContext) -> Bool   // userId != nil && accessMode != .signedOutRequired
  static func canPlay(_ book: AssistantBookRow, _ ctx: AssistantRuntimeContext) -> PlayGate  // .allowed | .signInRequired | .cannotStream
}
```
`canPlay`: `signedOutRequired` → `.signInRequired`; downloaded → `.allowed`; else `ctx.canStream ? .allowed : .cannotStream`.

### 4.2 Intents (one file each under `src/native/assistant/intents/`)

| Intent | Parameters | Behaviour | Reply |
|---|---|---|---|
| `PlayAudiobookIntent` (`AudioPlaybackIntent`) | `book: AssistantBookEntity` (optional). `openAppWhenRun = false`. | No book → same as Resume. Else guard via policy; `dispatcher.perform(.play(libraryItemId))`. | "Playing *Title* by *Author*." + card. Failures map codes → dialogs: `cannotStream` "That book isn't downloaded and you're offline."; `signInRequired` "Sign in to LAABS Audio first." with `OpensIntent`/`openAppWhenRun` fallback; `timeout` "LAABS Audio couldn't start playback. Open the app to continue." |
| `ResumeListeningIntent` (`AudioPlaybackIntent`) | none | `dispatcher.perform(.resume)`; JS resumes Active Playback, else most recent (`reader.mostRecent()` id supplied by Swift as a hint in the request — extend `resume` with `fallbackLibraryItemId?`). Nothing → `.result(opensIntent: OpenLAABSIntent())`. | "Resuming *Title*." |
| `PauseListeningIntent` (`AudioPlaybackIntent`) | none | requires runtime ready. | "Paused." / "Nothing is playing." |
| `IsBookInLibraryIntent` | `query: String` (`\(\.$query)` in phrase) | `reader.search(limit: 5)`. Read-only; no JS. | Yes → "Yes — *Title* by *Author*, 43% listened, downloaded." + card. Several → speak first, show list. None → "I couldn't find *query* in your LAABS library." |
| `BooksByAuthorIntent` | `author: String` | `reader.booksByAuthor(limit: 10)` | "You have 7 books by Stephen King, including *A*, *B*, *C*…" (speak ≤5) + list snippet. |
| `BookmarkHereIntent` | `title: String?` | `dispatcher.perform(.bookmarkHere(title))` | "Bookmarked *Title* at 1:23:45." |
| `SetSleepTimerIntent` | `mode: SleepTimerModeEnum` (`minutes`, `endOfChapter`, `endOfNextChapter`, `cancel`), `minutes: Int?` (1…360) | `dispatcher.perform(.sleepTimer)` | "Sleep timer set for 30 minutes." / "…until the end of this chapter." / "Sleep timer cancelled." |
| `OpenLAABSIntent` | none; `openAppWhenRun = true` | used as the open-app fallback | — |

All intents: `static var isDiscoverable = true` (except `OpenLAABSIntent` → false). Every failure returns `.result(dialog:)` — never `throw` for expected conditions, so Siri speaks our wording.

### 4.3 App Shortcuts — `AssistantShortcuts.swift`

```swift
struct AssistantShortcuts: AppShortcutsProvider {
  static var shortcutTileColor: ShortcutTileColor = .teal
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: PlayAudiobookIntent(), phrases: [
      "Play \(\.$book) in \(.applicationName)",
      "Listen to \(\.$book) in \(.applicationName)",
      "Play \(.applicationName)",                      // no parameter → Resume
    ], shortTitle: "Play a Book", systemImageName: "play.fill")
    AppShortcut(intent: ResumeListeningIntent(), phrases: [
      "Resume \(.applicationName)", "Continue listening in \(.applicationName)", "Resume my book in \(.applicationName)",
    ], shortTitle: "Resume", systemImageName: "play.circle")
    AppShortcut(intent: PauseListeningIntent(), phrases: ["Pause \(.applicationName)"], shortTitle: "Pause", systemImageName: "pause.fill")
    AppShortcut(intent: IsBookInLibraryIntent(), phrases: [
      "Does \(.applicationName) have \(\.$query)", "Is \(\.$query) in \(.applicationName)", "Search \(.applicationName) for \(\.$query)",
    ], shortTitle: "Find a Book", systemImageName: "magnifyingglass")
    AppShortcut(intent: BooksByAuthorIntent(), phrases: ["Books by \(\.$author) in \(.applicationName)"], shortTitle: "Books by Author", systemImageName: "person.crop.rectangle.stack")
    AppShortcut(intent: BookmarkHereIntent(), phrases: ["Bookmark this in \(.applicationName)", "Add a bookmark in \(.applicationName)"], shortTitle: "Bookmark Here", systemImageName: "bookmark.fill")
    AppShortcut(intent: SetSleepTimerIntent(), phrases: ["Set a sleep timer in \(.applicationName)", "Sleep timer \(.applicationName)"], shortTitle: "Sleep Timer", systemImageName: "moon.zzz.fill")
  }
}
```

Note the application name Siri expects is the `CFBundleDisplayName` ("LAABS Audiobookshelf"). If the user wants "LAABS Audio" to work, add `INAlternativeAppNames` (`["LAABS Audio", "LAABS"]`) to Info.plist via a new plugin `plugins/with-assistant.js` (`withInfoPlist`). This is the only Info.plist change v1 needs.

`Suggested Assistant Books` refresh: `AssistantShortcuts.updateAppShortcutParameters()` is called from `AssistantBridge.refreshSuggestedBooks()`; TS calls it on `assistantCatalogChanged` (debounced 2 s) and at startup.

### 4.4 Snippets — `AssistantSnippetViews.swift`

`AssistantBookCard(book:)` (cover 56pt, title, author, progress bar + "43% · downloaded") and `AssistantBookList(books:)` (up to 10 compact rows). Return with `.result(dialog:view:)`. Cover: `UIImage(contentsOfFile: coverPath)` else `AsyncImage(cover_url)` else placeholder book glyph.

---

## Phase 5 — JS action handlers & startup wiring

### 5.1 `src/assistant/assistant-action-handlers.ts`

```ts
export const handleAssistantAction = async (req: AssistantActionRequest): Promise<AssistantActionResult>
```
- `play`: `await playerService.loadBook(req.libraryItemId, { autoPlay: true })`; wait until `playbackStore.playbackState` reaches `"playing"` or an error within 8 s (subscribe, don't poll); return title from `playbackStore.bookTitle`.
- `resume`: if `playbackStore.libraryItemId` and loaded → `playerService.play()`; if `libraryItemId` set but idle (persisted last book) → `loadBook(id, { autoPlay: true })` (or `loadEpisode` when `episodeId`); else use `req.fallbackLibraryItemId`; else `nothingPlaying`.
- `pause`: `playerService.pause()` if playing else `nothingPlaying`.
- `togglePlayPause`: playing → pause; loaded-paused → play; idle with last book → resume path; nothing → `nothingPlaying` (Swift opens app).
- `bookmarkHere`: requires `playbackStore.libraryItemId`; `positionSeconds = Math.floor(positionMs/1000)`; title = `req.title?.trim() || defaultAssistantBookmarkTitle(chapterTitle, positionSeconds)`; create via `deviceBooksStore.getState().actions.addBookmark(libraryItemId, { kind: "point", startTimeSeconds, title, ... }, options)` — mirror exactly what `BookAddBookmarkDraftProvider` passes on save (read it first; reuse its helper if one exists rather than duplicating server-link fields). Works for Episodes (ADR-0032 local episode bookmarks).
- `sleepTimer`: `sleepTimerStore.getState().actions.startMinutesTimer(minutes ?? undefined)` / `startChapterTimer(mode)` (refuse chapter modes with `canSetChapterTimer === false` → `unsupported`, "This book has no chapters.") / `stopTimer()`. Requires active playback for non-cancel modes.

`src/assistant/assistant-bookmark-title.ts`: `defaultAssistantBookmarkTitle(chapterTitle: string | null, positionSeconds: number)` → `"Chapter 12 · 1:23:45"` or `"Bookmark · 1:23:45"`. Unit-test it.

### 5.2 `_layout.tsx`

- In the mount effect next to `playerService.init()`: `publishAssistantRuntimeContext()` and `startAssistantRuntimeContextSubscription()`.
- In the `warmupEligible` effect (create a dedicated effect that runs *before* the restore one in source order): `AssistantBridge.markRuntimeReady()`, `startAssistantActionListener(handleAssistantAction)`, and drain. If the drained action is `play`/`resume`/`togglePlayPause`, set `startupAssistantOwnsPlaybackRef.current = true`.
- Startup Active Playback Restore effect: add `if (startupAssistantOwnsPlaybackRef.current) return;` after the deep-link check, with a comment citing ADR-0040.

### 5.3 Tests

`assistant-action-handlers.test.ts` with mocked `playerService`, `playbackStore`, `sleepTimerStore`, `deviceBooksStore`: every `kind`, every failure code, exhaustive-switch compile check.

---

## Phase 6 — iOS 26 `.audio` schema (free-text Siri / Apple Intelligence)

Files under `src/native/assistant/audio-schema/`, everything `@available(iOS 26, *)`.

1. `AssistantAudiobookSchemaEntity.swift`: `@AssistantEntity(schema: .audio.audiobook) struct AudiobookSchemaEntity` wrapping `AssistantBookEntity` fields (title, author→`artist`-equivalent per schema, duration, artwork). Follow the macro's generated property requirements exactly; fix-its tell you what is missing.
2. `AssistantAudioSearchQuery.swift`: extend `AssistantBookQuery` with `IntentValueQuery` for `AudioSearch`:
   - `.searchQuery(text)` → `reader.search(text, limit: 10)`
   - `.unspecified` → `[reader.mostRecent()]` (this is the "Play LAABS Audio" → Resume rule)
   - `.url(url)` → parse `laabsaudio:///<id>` → `reader.book(byLibraryItemId:)`
3. `PlayAudioSchemaIntent.swift`: `@AppIntent(schema: .audio.playAudio) struct PlayAudioSchemaIntent: AudioStartingIntent` — delegates to the same `dispatcher.perform(.play)` / resume path; ignore `playbackAttributes`/`queueLocation` in v1 (log them).
4. `WarmupAudioQueueIntent` (schema `warmupAudioQueue`): optional; implement as a no-op that returns a result so Siri's pre-warm doesn't fail. Include only if the `playAudio` macro requires it.
5. Gate: wrap registrations in `if #available(iOS 26, *)`. Confirm the 16.4 build still compiles (the macros are only expanded inside available-gated types).

Acceptance: on an iOS 26 device, "Play The Shining in LAABS" with a book **not** in Suggested Assistant Books plays it; "Search for Stephen King books in LAABS" returns results; "Play LAABS" resumes.

---

## Phase 7 — Spotlight (`IndexedEntity`, iOS 18+)

1. `AssistantBookEntity: IndexedEntity` (in an `@available(iOS 18, *)` extension) with `attributeSet` providing `title`, `contentDescription` ("by Author · Narrated by N"), `thumbnailURL` (`coverPath`), `keywords` (author, series, narrator).
2. `AssistantSpotlightIndexer.swift`: `reindex(userId:)` → reads `reader.all(limit: 5000)` (downloaded-only when `accessMode == .downloadedOnly`), `CSSearchableIndex.default().indexAppEntities(...)` (replace-all: delete domain `laabs.assistant.<userId>` then index). `clear()` deletes all domains.
3. Tap handling: with `IndexedEntity` the system opens the app and delivers the entity id via `application(_:continue:)` / `NSUserActivity` of type `CSSearchableItemActionType`. Add `onContinueUserActivity` handling in the AppDelegate via `plugins/with-assistant.js` (`withAppDelegate`, same anchored-insertion style as `with-transcription-background.js`) that translates the entity id into `laabsaudio:///<libraryItemId>` and opens it through `RCTLinkingManager` — reusing the existing deep-link path so book detail opens with no new routing code.
4. Triggers: `assistantCatalogChanged` (debounced 5 s) → `AssistantBridge.reindexSpotlight(userId)`; explicit logout → `clearSpotlightIndex()`; Session Entry Switch → reindex new user.

---

## Phase 8 — Control Center / Lock Screen control (iOS 18+)

`AssistantPlaybackControl.swift`:

```swift
@available(iOS 18, *)
struct AssistantPlaybackControl: ControlWidget {
  static let kind = "com.markmccoid.laabs-audio.assistant.playback"
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind, provider: AssistantPlaybackStateProvider()) { state in
      ControlWidgetToggle(state.title, isOn: state.isPlaying, action: TogglePlaybackIntent()) { isOn in
        Label(isOn ? "Pause" : "Play", systemImage: isOn ? "pause.fill" : "play.fill")
      }
    }
    .displayName("LAABS Audio")
    .description("Play or pause your current audiobook")
  }
}
```

- **Controls live in a widget extension**, not the app. Since the widget extension is generated by `expo-widgets`, put the control in the *app* only if Apple allows (it does not — `ControlWidget` must be in a WidgetKit extension). Therefore Phase 8 has two options; pick at implementation time after checking the `expo-widgets` config plugin:
  - (a) `expo-widgets` exposes a hook to add extra Swift files to `ExpoWidgetsTarget` → add the control there, sharing state through App Group `UserDefaults` (`group.com.markmccoid.laabs-audio`, key `laabs.assistant.playbackState` = `{title, isPlaying, libraryItemId}` written by `active-audiobook-widget-publisher.ts`, which already tracks this).
  - (b) No hook → small `withXcodeProject` plugin that adds `src/native/assistant/controls/*.swift` to `ExpoWidgetsTarget`'s sources.
- `TogglePlaybackIntent` in the extension cannot reach the player; it must be an `AppIntent` with `openAppWhenRun = false` whose `perform()` posts a Darwin notification and **also** sets a pending `togglePlayPause` in the shared App Group defaults; the app-side `AssistantActionDispatcher` observes the Darwin notification when alive. If the app is not alive, the control falls back to `openAppWhenRun = true` behaviour (set dynamically by checking the shared `isAppAlive` heartbeat the app writes every 30 s while playing).
- Action button binds to the same intent via Settings automatically once the control exists.
- `AssistantBridge.reloadControls()` → `ControlCenter.shared.reloadControls(ofKind:)` on every playback state change (throttle 1 s) from `active-audiobook-widget-publisher.ts`.

This phase is the only one that touches the widget extension and is intentionally last; ADR-0040 is unaffected (the control is a WidgetKit surface, not an Assistant Action host).

---

## Phase 9 — In-app discoverability

- Settings → new row "Siri & Shortcuts" (`src/app/(tabs)/settings/siri-shortcuts.tsx`): lists the phrases from 4.3 verbatim, a `ShortcutsLink` (`@expo/ui/swift-ui` host view wrapping `SiriTipView`/`ShortcutsLink` if available; else a "Open Shortcuts" `Linking.openURL("shortcuts://")`).
- Main player: show `SiriTipView(intent: ResumeListeningIntent())` once (flag in `settingsStore`: `hasSeenAssistantTip`).

---

## Phase 10 — QA matrix (device only)

| Scenario | Expect |
|---|---|
| App force-quit; "Resume LAABS" | app launches in background, audio starts ≤10 s, Siri says "Resuming *Title*"; UI not shown |
| App force-quit; "Does LAABS have The Shining" | answer with no visible app launch |
| App in foreground; "Pause LAABS" | pauses, "Paused." |
| Nothing ever played; "Resume LAABS" | app opens |
| Downloaded-Only Mode, airplane mode; "Play ⟨downloaded book⟩" | plays; "Play ⟨streamed book⟩" → "not downloaded and you're offline" |
| Signed-Out Required Sign-In; any action | "Sign in to LAABS Audio first" + app opens on tap |
| Two "Shining" editions; "Play The Shining" | Siri disambiguation list |
| 4+ matches | plays top title match, says so |
| "Bookmark this as great quote" while playing | Point Bookmark titled "great quote" visible in Bookmark List |
| "Bookmark this" | title "Chapter N · h:mm:ss" |
| "Set a sleep timer for 20 minutes" | timer active in player sheet |
| "Set a sleep timer" (no duration) | uses `draftMinutes` |
| Session Entry Switch to user B | Spotlight shows only B's books; Suggested Assistant Books refresh |
| Explicit logout | Spotlight empty; Siri read-only actions say sign-in required |
| iOS 26 device: "Play ⟨book not in suggestions⟩ in LAABS" | plays via audio schema |
| iOS 17 device: same phrase | fails gracefully (Siri asks which book / offers suggestions) — expected limitation |
| Startup with pending play + `restoreLastBookOnStartup` on | pending play wins; no double load |

---

## Sequencing & estimates

1. Phase 0 spike — half a day; **stop the project if it fails and revisit ADR-0040 option 1.**
2. Phase 1 (catalog) and Phase 2 (bridge) in parallel — 1.5 days.
3. Phase 3 + 4 — 2 days. Ship-able milestone: Siri on 16.4+ with Suggested Assistant Books.
4. Phase 5 — 1 day (includes the `_layout.tsx` ordering change; test startup restore regression).
5. Phase 6 — 1 day on an iOS 26 device.
6. Phase 7 — half a day.
7. Phase 8 — 1–1.5 days (the extension question in 8 decides which).
8. Phase 9 + 10 — 1 day.

## Files touched outside `src/native/assistant` and `src/assistant`

- `src/data/sqlite/shadow-db-core.ts` (schema v9), `refresh-coordinator.ts`, `overlay-writes.ts`, new `assistant-catalog-writes.ts`
- `src/store/device-books-store.ts` (download transitions)
- `src/auth/*` session entry / logout (rebuild, clear)
- `src/app/_layout.tsx` (context publish, runtime-ready, drain, restore guard)
- `src/widgets/active-audiobook-widget-publisher.ts` (Phase 8 shared state + `reloadControls`)
- `plugins/with-assistant.js` (+ `app.json` plugins entry): `INAlternativeAppNames`, Spotlight continue-activity hook, optionally Phase 8 sources
- `src/app/(tabs)/settings/…` (Phase 9)
- `docs/shadow-sqlite-tables.md`: document `assistant_catalog` / `assistant_catalog_meta`
- `CONTEXT.md` / ADR-0040: already updated; amend the ADR only if Phase 0 or Phase 8 changes a decision.
