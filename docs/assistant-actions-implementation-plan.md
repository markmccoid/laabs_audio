# Assistant Actions (Siri / Shortcuts / Spotlight) — Implementation Plan

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
| Swift placement | Main app target, `src/native/assistant/`, compiled by the existing inline-module path (`Podfile.properties.json` → `expo.inlineModules.watchedDirectories: ["src/native"]`). **No `expo-apple-targets`, no Assistant Action extension target.** |
| Widget | Untouched. Stays on `expo-widgets`. |
| iOS floor | Stays `16.4`. App Shortcuts everywhere; `.books.audiobook` / `.books.playAudiobook` behind `@available(iOS 18, *)`; `.audio` schema + `AudioSearch` behind `@available(iOS 27, *)`; `IndexedEntity` behind `@available(iOS 18, *)`. |
| Catalog access | Swift reads only `assistant_catalog` (a TS-owned projection table in `laabs-shadow-library.db`). Never `library_catalog_*`, `user_server_progress`, or `user_favorites`. |
| Scope | Exactly the chosen Audiobookshelf User Identity, **all** its cached audiobook Libraries, plus its retained downloaded audiobooks when a server catalog row is missing. Session Entry physically replaces the projection; explicit logout clears it and disables assistant surfaces until another session is chosen. No podcasts/episodes in the catalog. |
| v1 actions | Play ⟨book⟩, Resume, Pause, Is ⟨book⟩ in my library, Books by ⟨author⟩, Bookmark here, Sleep timer (minutes / end of chapter / end of next chapter / cancel). |
| Play semantics | Ordinary Playback Start Attempt (`playerService.loadBook(id, { autoPlay: true })`). ≤3 matches → Siri disambiguation; more → best title match, stated in reply. No spoken title → Resume. |
| Cold launch | Pending Assistant Action in Swift memory + `UserDefaults`; JS drains at the `warmupEligible` gate; Swift waits ≤10 s then fails with "Open LAABS Audio". A pending play overrides Startup Active Playback Restore's never-auto-play rule. |
| Bookmark title | Spoken title if given, else `"<Chapter title> · h:mm:ss"` (or `"Bookmark · h:mm:ss"` with no chapters). Never empty. Allowed for Episodes. |
| Reply style | Spoken dialog + SwiftUI snippet card (cover, title, author, progress). Lists: speak ≤5, show all returned (cap 10). |
| Spotlight | `IndexedEntity` mirror of the catalog; tap runs an `OpenIntent` that routes to `laabsaudio:///<libraryItemId>` (detail only, no playback). Explicit logout clears the index. |
| Control Center / Action button | Deferred beyond this release. A widget-extension intent cannot reliably drive the JS-owned player when the app process is dead, and a Darwin notification cannot launch it. |
| Language | English only. |

## Architecture at a glance

```
 Siri / Shortcuts / Spotlight
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

- **JS alive** (app foreground or background-audio): after an atomic listener/readiness handshake, Swift `perform()` calls `AssistantBridge` → emits `onAssistantAction` → TS handler runs → TS calls `AssistantBridge.completeAction(id, result)` → Swift continuation resumes → reply.
- **JS not alive** (cold launch in background by the system to run the intent): Swift parks one expiring Pending Assistant Action, RN boots in parallel, `_layout.tsx` atomically attaches the listener and drains it at `warmupEligible`, then uses the same completion path. A competing action receives an immediate busy failure instead of overwriting the accepted action. Read-only actions never touch JS at all.

---

## Phase 0 — Spike: metadata plus cold React Native completion (gate for everything else)

Apple's `appintentsmetadataprocessor` must see the intents in the **app target**, and an
`openAppWhenRun = false` playback action must be able to launch the app process, wait for React Native,
and receive a completion before Siri's deadline. Inline modules compile `src/native/**/*.swift` into
`LAABSAudiobookshelf`, which is what we need — but prove both assumptions before writing the catalog or
shipping intents.

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
2. Add the smallest viable `AssistantBridge` pending-action path from Phase 2: the spike parks an
   expiring request when JS is unavailable; `_layout.tsx` atomically attaches its listener, marks the
   runtime ready, drains the request, starts the currently persisted audiobook through
   `playerService`, and completes the Swift continuation.
3. `npx expo prebuild --clean -p ios && npx expo run:ios --device` (App Intents are only reliable on a device).
4. Verify the build log contains `appintentsmetadataprocessor` with no "metadata extraction skipped"
   warning; `LAABSAudiobookshelf.app/Metadata.appintents/` exists; and the Shortcuts app shows "Spike"
   under the LAABS app.
5. Force-quit the app and invoke the spike. Verify the app process launches without foreground UI,
   React Native drains the request, audio reaches Audible Playback State, and Siri receives the
   completion inside 10 seconds. Repeat with the app alive and with two nearly concurrent requests;
   the second request must receive a busy result rather than overwrite the first.
6. If extraction fails: check the target's `Other Swift Flags` / that the files are in the main target's compile sources (not a pod). Fallback (only if needed): a small config plugin `plugins/with-assistant-sources.js` using `withXcodeProject` to add `src/native/assistant` as a synchronized group — but the inline-module path should already do this.
7. Evolve the spike bridge into the production bridge in Phase 2 and delete only the spike intent once
   Phase 4 lands.

**Exit criterion:** metadata extraction succeeds and a force-quit invocation completes real playback
through the React Native bridge within 10 seconds. If either fails, stop and revisit ADR-0040.

---

## Phase 1 — Assistant Catalog (TypeScript, SQLite)

### 1.1 Schema — `src/data/sqlite/shadow-db-core.ts`

Bump `SCHEMA_VERSION` to 9 and add (idempotent `CREATE TABLE IF NOT EXISTS`, following the existing migration pattern in that file):

```sql
CREATE TABLE IF NOT EXISTS assistant_catalog (
  user_id            TEXT    NOT NULL,   -- Audiobookshelf User Identity (same value as library_catalog_items.user_id)
  library_item_id    TEXT    NOT NULL,
  library_id         TEXT    NOT NULL,
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
export const rebuildAssistantCatalog = (input: {
  userId: string;
  downloadedBooks: readonly AssistantDownloadedBookInput[];
}): Promise<{ rowCount: number }>;
export const patchAssistantCatalogProgress = (userId: string, libraryItemId: string, patch: {
  progressPercent: number; currentTimeSeconds: number; isFinished: boolean; lastPlayedAt?: number;
}): Promise<void>;
export const patchAssistantCatalogFavorite = (userId: string, libraryItemId: string, isFavorite: boolean): Promise<void>;
export const patchAssistantCatalogDownloaded = (userId: string, libraryItemId: string, isDownloaded: boolean): Promise<void>;
export const clearAssistantCatalog = (userId?: string): Promise<void>; // undefined = all users
```

`rebuildAssistantCatalog`:
- Runs under `withWriteGuard` + `runInTransaction`.
- First make `ActiveLibraryContext` carry `mediaType` and make `upsertLibrary` persist/update it; the existing writer currently stores `NULL`. Source rows are `library_catalog_items` joined to `libraries` where `libraries.media_type = 'book'` (audiobook libraries only) and `is_missing = 0`, for `user_id = input.userId`. Left-join `user_server_progress` and `user_favorites`.
- Union retained audiobook downloads owned by `input.userId` when their catalog row is absent or marked missing. `AssistantDownloadedBookInput` is built outside the SQLite layer from `deviceBooksStore.downloadedDetailsById`, `downloadedBookData`, and `downloadedOwnerUserIdsById`, and supplies the retained presentation metadata, duration, cover path, and library id. Do not import the store into the SQLite layer.
- `series_sequence` and `subtitle` come from `summary_json` if present.
- `cover_path`: resolve through `resolveCachedWidgetArtworkUri` when a cached file exists; otherwise NULL. (Do not trigger downloads here; the snippet falls back to `cover_url` or a placeholder.)
- Physically replace the projection: delete every row in `assistant_catalog` and `assistant_catalog_meta`, then bulk insert only `input.userId` in chunks of 500 and insert its metadata row.
- Emits `assistantCatalogChanged` on a tiny event emitter (`src/assistant/assistant-catalog-events.ts`) so Phase 5/7 can react (Suggested Assistant Books refresh, Spotlight reindex).

### 1.4 Assistant Book identity

Entity id string: `${user_id}|${library_item_id}`. The Audiobookshelf User Identity is globally unique in this domain and remains stable when the Server Connection Endpoint changes. Helpers in `src/assistant/assistant-identity.ts` (TS) and `AssistantBookID` (Swift): `parse`, `format`. Both sides reject ids without exactly one `|` and validate the parsed user id against the published runtime context.

### 1.5 Hook points

| Where | Call |
|---|---|
| `refresh-coordinator.ts` → `refreshActiveLibrary`, immediately before `invalidateSqliteQueries(...)` | `await rebuildAssistantCatalog({ userId: scope.userId, downloadedBooks })` when catalog **or** overlay refreshed. Wrap in try/catch + `recordTimingLog("assistant", "catalog_rebuild", …)`; a failure must never fail the library refresh. |
| `overlay-writes.ts` → `upsertShadowServerProgressProjection` | after the write: `patchAssistantCatalogProgress(...)`, passing `lastPlayedAt: Date.now()` only when called from `player-service.ts` (add an optional flag to the existing function rather than a second call site). |
| `overlay-writes.ts` → `setShadowFavoriteProjection` | `patchAssistantCatalogFavorite(...)`. |
| `device-books-store.ts` download completed / removed | `patchAssistantCatalogDownloaded(...)`. Locate the transitions to `status: "completed"` (≈ L3721) and the remove-download action. |
| Session Entry Switch (`src/auth/user-session-entry*.ts`) | after the new session commits: physically replace the projection with `rebuildAssistantCatalog({ userId: newUserId, downloadedBooks })`; no previous-user rows remain. |
| Explicit logout | `clearAssistantCatalog(userId)` **and** `AssistantBridge.clearSpotlightIndex()` (Phase 7). |

### 1.6 Telling Swift where the DB is and who the user is

Swift must not guess the expo-sqlite directory. At startup (`_layout.tsx`, next to `playerService.init()`), and again on any Session Entry Switch / logout / Access Mode change, JS calls:

```ts
AssistantBridge.publishRuntimeContext({
  dbPath: `${SQLite.defaultDatabaseDirectory}/laabs-shadow-library.db`,
  userId: resolveAssistantUserId(authState), // active identity, or stored identity in downloadedSessionOnly; null after explicit logout/downloadedOnly
  accessMode: "hydrating" | "firstRunSignInRequired" | "downloadedOnly" | "downloadedSessionOnly" | "serverSetup" | "serverBrowsing",
  canAttemptStreaming: boolean, // authenticated session with usable credentials; network failure is still handled by playback
});
```

The bridge persists this in `UserDefaults.standard` under `laabs.assistant.runtimeContext` so a cold-launched intent has it before JS is up. Create `src/assistant/assistant-runtime-context.ts` to compute it from `authStore` / access-mode selectors, and subscribe so republishing is automatic. `userId == null` disables every assistant surface; explicit logout publishes that disabled context after clearing the catalog and Spotlight index. `downloadedSessionOnly` retains its remembered identity, while anonymous `downloadedOnly` does not enable assistant surfaces.

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
  | { id: string; kind: "sleepTimer"; mode: "minutes" | "end_of_chapter" | "end_of_next_chapter" | "cancel"; minutes: number | null };

export type AssistantPlayableRef =
  | { kind: "audiobook"; libraryItemId: string }
  | { kind: "episode"; libraryItemId: string; episodeId: string };

export type AssistantActionResult =
  | { ok: true; kind: "play" | "resume"; playable: AssistantPlayableRef; title: string; isPlaying: boolean }
  | { ok: true; kind: "pause" }
  | { ok: true; kind: "bookmarkHere"; title: string; positionSeconds: number; playableTitle: string }
  | { ok: true; kind: "sleepTimer"; description: string }
  | { ok: false; code: "nothingPlaying" | "signInRequired" | "cannotStream" | "notFound" | "playbackFailed" | "timeout" | "busy" | "unsupported"; message: string };
```

Exhaustive `switch` with a `never` default on `kind` in every TS handler.

### 2.3 Swift API (`AssistantActionDispatcher`)

```swift
actor AssistantActionDispatcher {
  static let shared = AssistantActionDispatcher()
  private(set) var isRuntimeReady: Bool
  func perform(_ request: AssistantActionRequest, timeout: Duration = .seconds(10)) async -> AssistantActionResult
  func activateRuntimeAndTakePending() -> AssistantActionRequest? // atomic ready + drain after listener attach
  func complete(id: String, result: AssistantActionResult) // JS → Swift
}
```

`perform`:
1. Store `CheckedContinuation` under `request.id`.
2. If `isRuntimeReady` → `sendEvent("onAssistantAction", request)`.
   Else, if the pending slot is empty → write `{ request, acceptedAt, expiresAt }` to memory **and**
   `UserDefaults` key `laabs.assistant.pendingAction`. If another unexpired action is already pending,
   return `.failure(code: "busy")` immediately rather than overwrite it.
3. Race the continuation against the timeout; on timeout remove only the matching continuation/slot
   and return `.failure(code: "timeout")`. Startup discards persisted requests whose `expiresAt` has
   passed, so a timed-out action can never auto-play on a later launch.

Only `play` and `resume` may be parked as Pending Assistant Actions. `pause`, `bookmarkHere`, and
`sleepTimer` with `isRuntimeReady == false` return `nothingPlaying` immediately (there is no audible
playback if the process was not alive).

### 2.4 Expo module surface (`AssistantBridge.swift`)

```
Name("AssistantBridge")
Events("onAssistantAction")
Function("publishRuntimeContext") { (ctx: [String: Any]) }          // 1.6
AsyncFunction("activateRuntimeAndTakePending") -> [String: Any]?       // atomic ready + drain
Function("completeAction") { (id: String, result: [String: Any]) }
AsyncFunction("refreshSuggestedBooks")                                 // Phase 5: AppShortcutsProvider.updateAppShortcutParameters()
AsyncFunction("reindexSpotlight") { (userId: String?) }                // Phase 7
AsyncFunction("clearSpotlightIndex")                                  // Phase 7
OnDestroy { await AssistantActionDispatcher.shared.deactivateRuntime() }
```

### 2.5 TS side (`src/assistant/assistant-bridge.ts`)

- `startAssistantActionListener(handler: (req) => Promise<AssistantActionResult>)`: first subscribes to
  `onAssistantAction`, then calls `activateRuntimeAndTakePending()` to atomically mark Swift ready and
  claim the pending request. Call from `_layout.tsx` inside the `warmupEligible` effect **before** the
  Startup Active Playback Restore effect body runs. If a pending `play`/`resume` exists, set
  `startupAssistantOwnsPlaybackRef = true` before handling it so restore cannot compete.
- Every handler must `completeAction(id, result)` in a `finally`.

---

## Phase 3 — Assistant Book entity & catalog reader (Swift)

### 3.1 `AssistantCatalogReader.swift`

- `import SQLite3`; open `runtimeContext.dbPath` with `SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX`; WAL readers need no extra setup. Check `assistant_catalog_meta.contract_version == 1` for the user; otherwise treat as empty and log.
- Queries (all filtered by `user_id = runtimeContext.userId`):
  - `book(byID:)` — parse `${userId}|${libraryItemId}`, reject a user id that differs from runtime context, then query by both values.
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
  - downloaded-only variants when `accessMode == "downloadedSessionOnly"` (append `AND is_downloaded = 1`). Anonymous `downloadedOnly` has no Assistant user and is disabled.
- All reads on a serial `DispatchQueue`; the connection is opened lazily and reopened if `dbPath` changes.

### 3.2 `AssistantBookEntity.swift`

```swift
struct AssistantBookEntity: AppEntity, Identifiable {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Audiobook")
  static var defaultQuery = AssistantBookQuery()
  var id: String                      // "userId|libraryItemId"
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

For exact play resolution, `entities(matching:)` returns every ranked match when there are 1–3, so
Siri can disambiguate, but returns only the best title match when there are more than 3. Keep the base
entity schema-free so 16.4 builds compile; Phase 6 adds availability-gated `.books` and `.audio`
schema wrappers that share this reader.

---

## Phase 4 — v1 intents, App Shortcuts, replies (Swift)

### 4.1 Access-mode guard — `AssistantAccessPolicy.swift`

```swift
enum AssistantAccessPolicy {
  static func canAnswerReadOnly(_ ctx: AssistantRuntimeContext) -> Bool   // userId != nil
  static func canPlay(_ book: AssistantBookRow, _ ctx: AssistantRuntimeContext) -> PlayGate  // .allowed | .signInRequired | .cannotStream
}
```
`canPlay`: no chosen `userId` → `.signInRequired`; downloaded → `.allowed`; else
`ctx.canAttemptStreaming ? .allowed : .cannotStream`.

### 4.2 Intents (one file each under `src/native/assistant/intents/`)

| Intent | Parameters | Behaviour | Reply |
|---|---|---|---|
| `PlayAudiobookIntent` (`AudioStartingIntent`, available on the 16.4 floor) | `book: AssistantBookEntity` (optional). `openAppWhenRun = false`. | No book → same as Resume. Else guard via policy; `dispatcher.perform(.play(libraryItemId))`. | "Playing *Title* by *Author*." + card. Failures map codes → dialogs: `cannotStream` "That book isn't downloaded and you're offline."; `signInRequired` "Sign in to LAABS Audio first." with `OpensIntent`/`openAppWhenRun` fallback; `timeout` "LAABS Audio couldn't start playback. Open the app to continue." |
| `ResumeListeningIntent` (`AudioStartingIntent`) | none | `dispatcher.perform(.resume)`; JS resumes Active Playback or the persisted most recent Active Playback, including an Episode. Nothing → `.result(opensIntent: OpenLAABSIntent())`. | "Resuming *Title*." |
| `PauseListeningIntent` (`AppIntent`; the 16.4 floor predates `AudioPlaybackIntent`) | none | requires runtime ready. | "Paused." / "Nothing is playing." |
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

The public application name for Siri and Shortcuts is the `CFBundleDisplayName`, which is **LAABS Audio**. Keep that name aligned across Expo configuration, native metadata, App Shortcut phrases, and user-facing dialogs. An optional shorter alias such as "LAABS" can be added with `INAlternativeAppNames` only if physical-device testing shows it improves recognition.

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
- `resume`: if `playbackStore.libraryItemId` and loaded → `playerService.play()`; if a persisted playable is idle → `loadBook(id, { autoPlay: true })` or `loadEpisode(libraryItemId, episodeId, { autoPlay: true })`; else `nothingPlaying`. Return a discriminated `AssistantPlayableRef`.
- `pause`: `playerService.pause()` if playing else `nothingPlaying`.
- `bookmarkHere`: requires Active Playback; `positionSeconds = Math.floor(positionMs/1000)` and title = `req.title?.trim() || defaultAssistantBookmarkTitle(chapterTitle, positionSeconds)`. For an audiobook, call `deviceBooksStore.actions.addBookmark` with the actual ABS `Bookmark` shape (`libraryItemId`, `time`, `title`, `createdAt`) and the chosen user. For an Episode, call `episodeBookmarksStore.actions.save` with its full `EpisodeIdentity`. Reuse the existing UI save helpers where possible so server-link and ownership fields cannot drift.
- `sleepTimer`: `sleepTimerStore.getState().actions.startMinutesTimer(minutes ?? undefined)` / `startChapterTimer(mode)` / `stopTimer()`. Derive chapter-mode availability from the current playback/chapter state; there is no `canSetChapterTimer` store property. Requires Active Playback for non-cancel modes.

`src/assistant/assistant-bookmark-title.ts`: `defaultAssistantBookmarkTitle(chapterTitle: string | null, positionSeconds: number)` → `"Chapter 12 · 1:23:45"` or `"Bookmark · 1:23:45"`. Unit-test it.

### 5.2 `_layout.tsx`

- In the mount effect next to `playerService.init()`: `publishAssistantRuntimeContext()` and `startAssistantRuntimeContextSubscription()`.
- In the `warmupEligible` effect (create a dedicated effect that runs *before* the restore one in source order): install the listener, call `activateRuntimeAndTakePending()`, set `startupAssistantOwnsPlaybackRef.current = true` for a drained `play`/`resume`, then handle it.
- Startup Active Playback Restore effect: add `if (startupAssistantOwnsPlaybackRef.current) return;` after the deep-link check, with a comment citing ADR-0040.

### 5.3 Tests

`assistant-action-handlers.test.ts` with mocked `playerService`, `playbackStore`, `sleepTimerStore`, `deviceBooksStore`: every `kind`, every failure code, exhaustive-switch compile check.

---

## Phase 6 — availability-gated audiobook schemas

### 6.1 iOS 18–26 `.books` compatibility schema

Files under `src/native/assistant/books-schema/`, everything `@available(iOS 18, *)`.

1. `AssistantBooksAudiobookEntity.swift`: `@AppEntity(schema: .books.audiobook)` wrapper around the base Assistant Book fields and reader.
2. `PlayBooksAudiobookIntent.swift`: `@AppIntent(schema: .books.playAudiobook)` delegates to the same access policy and dispatcher. This preserves schema-backed audiobook playback on iOS 18–26. Apple deprecates this schema in the iOS 27 SDK, but it remains the supported compatibility path.

### 6.2 iOS 27 `.audio` schema (free-text Siri / Apple Intelligence)

Files under `src/native/assistant/audio-schema/`, everything `@available(iOS 27, *)`.

1. `AssistantAudiobookSchemaEntity.swift`: `@AppEntity(schema: .audio.audiobook) struct AudiobookSchemaEntity` wrapping `AssistantBookEntity` fields. Follow the macro's generated property requirements exactly; fix-its tell you what is missing.
2. `AssistantAudioSearchQuery.swift`: implement `IntentValueQuery` for `AudioSearch`:
   - `.searchQuery(text)` → `reader.search(text, limit: 10)`
   - `.unspecified` → `[reader.mostRecent()]` (this is the "Play LAABS Audio" → Resume rule)
   - `.url(urls)` → inspect the URL array, parse the first supported `laabsaudio:///<id>`, then call `reader.book(byID:)`
3. `PlayAudioSchemaIntent.swift`: `@AppIntent(schema: .audio.playAudio) struct PlayAudioSchemaIntent: AudioPlaybackIntent` — delegates to the same `dispatcher.perform(.play)` / resume path; ignore `playbackAttributes`/`queueLocation` in v1 (log them).
4. `WarmupAudioQueueIntent` (schema `warmupAudioQueue`): optional; implement as a no-op that returns a result so Siri's pre-warm doesn't fail. Include only if the `playAudio` macro requires it.
5. Gate Books registrations at iOS 18 and Audio registrations at iOS 27. Confirm the 16.4 build still compiles (the macros are only expanded inside availability-gated types).

Acceptance: on iOS 18–26, `.books.playAudiobook` resolves a named audiobook. On an iOS 27 device, "Play The Shining in LAABS" with a book **not** in Suggested Assistant Books plays it through `AudioSearch`; "Search for Stephen King books in LAABS" returns results; "Play LAABS" resumes.

---

## Phase 7 — Spotlight (`IndexedEntity`, iOS 18+)

1. `AssistantBookEntity: IndexedEntity` (in an `@available(iOS 18, *)` extension) with `attributeSet` providing `title`, `contentDescription` ("by Author · Narrated by N"), `thumbnailURL` (`coverPath`), `keywords` (author, series, narrator).
2. `AssistantSpotlightIndexer.swift`: use a named `CSSearchableIndex` and `indexAppEntities(...)`. Replace the current projection with App Intents entity deletion APIs (`deleteAppEntities(ofType:)` or identifier deletion as appropriate), not a Core Spotlight domain delete that was never assigned to the indexed entities. `clear()` removes every Assistant Book entity.
3. `OpenAssistantBookIntent: OpenIntent` has an `AssistantBookEntity` target and routes it to `laabsaudio:///<libraryItemId>` through the existing app-side deep-link path. Use the bridge to deliver or persist the route until React Native is ready; do not inject a `CSSearchableItemActionType` AppDelegate hook. Tapping an indexed book opens detail and never starts playback.
4. Triggers: `assistantCatalogChanged` (debounced 5 s) → `AssistantBridge.reindexSpotlight(userId)`; explicit logout → `clearSpotlightIndex()`; Session Entry Switch → reindex new user.

---

## Phase 8 — Deferred: Control Center / Action button

Do not implement a `ControlWidget` in this release. The extension cannot reach the JS-owned player, a
Darwin notification cannot launch a terminated app, `openAppWhenRun` is static rather than a heartbeat-
driven runtime choice, and `expo-widgets` regenerates both the extension sources and widget-bundle
registration. Revisit this only when playback can be driven by shared native machinery or the product
accepts an always-foreground fallback. No Phase 8 files or widget changes are part of this branch.

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
| Session Needs Sign-In / remembered offline session; "Play ⟨downloaded book⟩" | plays; "Play ⟨streamed book⟩" → "not downloaded and you're offline" |
| Signed-Out Required Sign-In; any action | "Sign in to LAABS Audio first" + app opens on tap |
| Explicit logout with downloads retained | Assistant Catalog and Spotlight are empty; every Assistant Action asks the user to choose/sign in to a session |
| Two "Shining" editions; "Play The Shining" | Siri disambiguation list |
| 4+ matches | plays top title match, says so |
| "Bookmark this as great quote" while playing | Point Bookmark titled "great quote" visible in Bookmark List |
| "Bookmark this" | title "Chapter N · h:mm:ss" |
| "Set a sleep timer for 20 minutes" | timer active in player sheet |
| "Set a sleep timer" (no duration) | uses `draftMinutes` |
| Session Entry Switch to user B | Spotlight shows only B's books; Suggested Assistant Books refresh |
| Explicit logout | Spotlight empty; Siri read-only actions say sign-in required |
| iOS 18–26 device: "Play ⟨book⟩ in LAABS" | resolves through the Books audiobook schema |
| iOS 27 device: "Play ⟨book not in suggestions⟩ in LAABS" | plays through `AudioSearch` and the Audio schema |
| iOS 17 device: same phrase | fails gracefully (Siri asks which book / offers suggestions) — expected limitation |
| Startup with pending play + `restoreLastBookOnStartup` on | pending play wins; no double load |

---

## Sequencing & estimates

1. Phase 0 spike — half a day; **stop the project if it fails and revisit ADR-0040 option 1.**
2. Phase 1 (catalog) and Phase 2 (bridge) in parallel — 1.5 days.
3. Phase 3 + 4 — 2 days. Ship-able milestone: Siri on 16.4+ with Suggested Assistant Books.
4. Phase 5 — 1 day (includes the `_layout.tsx` ordering change; test startup restore regression).
5. Phase 6 — 1–1.5 days across iOS 18/26 and iOS 27 devices.
6. Phase 7 — half a day.
7. Phase 9 + 10 — 1 day.

## Files touched outside `src/native/assistant` and `src/assistant`

- `src/data/sqlite/shadow-db-core.ts` (schema v9), `refresh-coordinator.ts`, `overlay-writes.ts`, new `assistant-catalog-writes.ts`
- `src/store/device-books-store.ts` (download transitions)
- `src/auth/*` session entry / logout (rebuild, clear)
- `src/app/_layout.tsx` (context publish, runtime-ready, drain, restore guard)
- `plugins/with-assistant.js` (+ `app.json` plugins entry): validated `INAlternativeAppNames` structure only if the Phase 0 device spike proves alternate-name recognition without an Intents extension
- `src/app/(tabs)/settings/…` (Phase 9)
- `docs/shadow-sqlite-tables.md`: document `assistant_catalog` / `assistant_catalog_meta`
- `CONTEXT.md` / ADR-0040: already updated; amend the ADR only if Phase 0 or Phase 8 changes a decision.
