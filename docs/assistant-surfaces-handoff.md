# Assistant Surfaces Handoff

Last updated: 2026-09-17  
Branch: `codex/assistant-actions`  
Implementation range: `master` (`45d5161`) through `5305c7a`

This is the current-state handoff for the Siri, Shortcuts, and Spotlight work. Read this before
continuing the feature. The implementation plan in
[`assistant-actions-implementation-plan.md`](./assistant-actions-implementation-plan.md) explains the
original sequence and acceptance matrix; it is not a reliable completion checklist anymore.
[`ADR-0040`](./adr/0040-assistant-actions-live-in-the-app-target-over-an-assistant-catalog.md) and
the **Assistant surfaces** section of [`CONTEXT.md`](../CONTEXT.md) remain the design authority.

## Current state

The branch contains the production implementation for iOS Siri/App Intents, App Shortcuts, and
Spotlight audiobook discovery. The TypeScript unit suites for action handling, catalog writes,
identity, text normalization, bookmark titles, and session entry exist. Physical-device acceptance
testing is still required.

Implemented:

- Seven App Shortcuts: play a named audiobook, resume, pause, find an audiobook, list books by
  author, bookmark the current position, and set/cancel a sleep timer.
- A native read-only Assistant Catalog containing the chosen user's audiobook libraries and retained
  downloaded audiobooks. Podcasts and Episodes are deliberately absent from catalog search, although
  Resume and Bookmark Here support an already active Episode.
- A cold-launch Swift-to-JavaScript bridge for Play and Resume, including a ten-second expiry,
  persisted pending request, busy protection, user binding, and late-side-effect cancellation.
- iOS 18 Books-schema audiobook playback and iOS 27 Audio-schema search/playback.
- iOS 18+ Spotlight indexing. A Spotlight result opens audiobook detail through the existing
  `laabsaudio:///libraryItemId` deep link and does not begin playback.
- Session isolation. Session entry replaces the Assistant Catalog; explicit logout/sign-in change
  clears the catalog and Spotlight; downloaded-session mode exposes only owned downloads.
- Settings > Siri & Shortcuts, with example phrases and a button that opens Apple's Shortcuts app.
- App display name `LAABS Audio`, app version `1.8.0`, Expo SDK 57 / React Native 0.86.3, and an
  explicit iOS 17.4 deployment floor (raised from 16.4 on 2026-09-21 for interactive Siri snippets;
  see the ADR-0040 amendment and
  [`assistant-search-next-phase-handoff.md`](./assistant-search-next-phase-handoff.md)).

Not implemented or not complete:

- Control Center and Action Button controls are intentionally deferred. Their extension cannot
  safely drive the JavaScript-owned player while the app is terminated.
- The planned one-time `SiriTipView` in the main player is not implemented. Discoverability currently
  exists only in Settings and the Shortcuts app.
- The native feature still needs the physical-device matrix in the implementation plan, especially
  cold launch, session changes, offline downloaded playback, iOS 18 Books schema, iOS 27 Audio
  schema, and Spotlight.
- iOS 17 has the schema-free App Shortcut surface but not the iOS 18/27 semantic audiobook schemas;
  named-book voice resolution is expected to be less capable there.

## User-visible features and implementation files

### Siri and App Shortcuts

`src/native/assistant/AssistantShortcuts.swift` registers the seven phrases and shortcut tiles.
Each action has its own intent under `src/native/assistant/intents/`:

| Feature | Primary files | Behavior |
| --- | --- | --- |
| Play an audiobook | `PlayAudiobookIntent.swift`, `AssistantBookEntity.swift` | Resolves a catalog entity, enforces offline/session policy, and asks JS to load it with autoplay. Omitting the book behaves like Resume. More than three text matches collapse to the ranked best match and report that choice. |
| Resume listening | `ResumeListeningIntent.swift`, `assistant-action-handlers.ts` | Resumes a loaded audiobook or Episode; after cold launch it restores the persisted playable and starts it. |
| Pause | `PauseListeningIntent.swift`, `assistant-action-handlers.ts` | Pauses active playback. It is only available while the JS runtime is alive. |
| Find an audiobook | `IsBookInLibraryIntent.swift`, `AssistantSnippetViews.swift` | Reads the catalog entirely in Swift and returns up to ten matching books without launching JS. |
| Books by author | `BooksByAuthorIntent.swift`, `AssistantSnippetViews.swift` | Performs normalized author matching and returns an alphabetized native result list. |
| Bookmark Here | `BookmarkHereIntent.swift`, `assistant-bookmark-title.ts`, `assistant-action-handlers.ts` | Saves an audiobook point bookmark through `deviceBooksStore` or an Episode point bookmark through `episodeBookmarksStore`. The fallback title is `Chapter · h:mm:ss` or `Bookmark · h:mm:ss`. |
| Sleep timer | `SetSleepTimerIntent.swift`, `assistant-action-handlers.ts` | Supports minutes, end of chapter, end of next chapter, and cancel through `sleepTimerStore`. Chapter modes validate the active chapter structure first. |

Common dialog/error mapping lives in
`src/native/assistant/intents/AssistantIntentSupport.swift`. The native result cards and book lists
are in `src/native/assistant/AssistantSnippetViews.swift`.

### Apple audiobook schemas

- `src/native/assistant/books-schema/AssistantBooksAudiobookEntity.swift` and
  `PlayBooksAudiobookIntent.swift` implement Apple's Books audiobook schema on iOS 18–26.
- `src/native/assistant/audio-schema/AssistantAudioAudiobookEntity.swift` and
  `PlayAudioSchemaIntent.swift` implement the iOS 27 Audio schema. Free-text `AudioSearch` maps to
  the same catalog search; an unspecified query maps to the most recently played book; supported
  LAABS URLs resolve directly to an entity.
- Both paths delegate to the same access policy and action dispatcher rather than owning playback.

### Spotlight

- `src/native/assistant/AssistantBookEntity.swift` conforms to `IndexedEntity` on iOS 18+ and
  supplies title, author/narrator description, keywords, artwork, and the audiobook deep link.
- `src/native/assistant/AssistantSpotlightIndexer.swift` replaces the named Spotlight index from the
  current Assistant Catalog and clears it at a session boundary.
- `src/native/assistant/intents/OpenAssistantBookIntent.swift` opens detail without playing.
- `src/assistant/assistant-surface-lifecycle.ts` debounces catalog-change reindexing by five seconds
  and suggested-shortcut refresh by two seconds.

### In-app discovery

- `src/components/settings/settings-home-screen.tsx` adds the iOS-only Settings row.
- `src/app/(tabs)/settings/_layout.tsx` registers the route.
- `src/app/(tabs)/settings/siri-shortcuts.tsx` is the thin route component.
- `src/components/settings/settings-siri-shortcuts-screen.tsx` lists supported phrases and opens
  `shortcuts://`.

## End-to-end architecture

### Catalog and read-only requests

1. TypeScript owns all writes to `assistant_catalog` and `assistant_catalog_meta` in
   `laabs-shadow-library.db`.
2. `src/native/assistant/AssistantCatalogReader.swift` opens that database read-only with SQLite3.
   It refuses missing or non-v1 catalog metadata and always filters by the published user identity.
3. Find, author-list, entity resolution, suggestions, and Spotlight reads stay native and do not
   wake the React Native runtime.
4. In `downloadedSessionOnly`, the reader adds `is_downloaded = 1`; when no user is published,
   Assistant surfaces return no data.

The projection is built from all cached Book libraries for one Audiobookshelf User Identity, not
only the active Library. It unions retained downloads whose server catalog row is absent. Search
fields normalize case, accents, punctuation, author, narrator, and series metadata. Search ranking is
exact title, title prefix, title contains, series, author, then narrator, with in-progress and recency
as tie breakers.

### Playback-changing requests

1. An App Intent calls `AssistantActionDispatcher.perform` in
   `src/native/assistant/AssistantActionDispatcher.swift`.
2. Swift binds the request to the current user and a ten-second deadline. If JS is ready it emits
   `onAssistantAction`; if JS is cold, only Play or Resume may occupy the persisted pending slot.
3. `src/assistant/assistant-bridge.ts` installs the event listener before atomically draining the
   pending request.
4. `src/assistant/assistant-action-handlers.ts` calls the existing `playerService`, bookmark stores,
   or sleep-timer store and completes the native continuation.
5. `src/app/_layout.tsx` starts runtime-context publication, catalog/Spotlight synchronization, and
   the action runtime. A drained Play/Resume owns startup playback so ordinary last-book restore does
   not race it.

The handler rechecks both expected user and expiry while work is running. If either changes before
completion, it returns a safe failure and best-effort stops or pauses playback that the stale request
started.

## Catalog write paths

`src/data/sqlite/assistant-catalog-writes.ts` is the single catalog writer. It provides full rebuild,
progress/favorite/download patches, and clearing. The schema and indexes are added in
`src/data/sqlite/shadow-db-core.ts` and documented in `docs/shadow-sqlite-tables.md`.

The existing app paths update it as follows:

| Trigger | Integration file | Effect |
| --- | --- | --- |
| Catalog or overlay refresh | `src/data/sqlite/refresh-coordinator.ts` | Rebuilds the entire chosen-user projection without failing the main library refresh if Assistant work fails. |
| Playback progress | `src/data/sqlite/overlay-writes.ts`, `src/player/player-service.ts`, `src/progress/progress-sync-intent-store.ts` | Patches progress and marks recent playback. |
| Favorite change | `src/data/sqlite/overlay-writes.ts` | Patches `is_favorite`. |
| Download completes or is removed | `src/store/device-books-store.ts` | Patches `is_downloaded`; removal also deletes an orphaned retained-download-only row. |
| User Session Entry | `src/auth/enter-user-session.ts`, `src/auth/session-boundary.ts` | Physically replaces the previous projection with the selected user's books and owned downloads. |
| Logout or sign-in change | `src/auth/session-boundary.ts`, `src/assistant/assistant-surface-lifecycle.ts` | Clears both catalog tables and the Spotlight index. |

Supporting files:

- `src/assistant/assistant-downloaded-books.ts` converts device-store records into projection inputs
  while enforcing download ownership.
- `src/assistant/assistant-catalog-events.ts` publishes rebuilt/patched/cleared events.
- `src/assistant/assistant-text.ts` and
  `src/assistant/__fixtures__/normalize-fixtures.json` define the TypeScript side of the shared
  search normalization contract.
- `src/assistant/assistant-identity.ts` defines the `userId|libraryItemId` entity identity contract.

## Runtime context and access policy

`src/assistant/assistant-runtime-context.ts` publishes the exact database path, chosen user, access
mode, and streaming eligibility whenever auth state changes. Native persistence and decoding live in
`src/native/assistant/AssistantRuntimeContext.swift`; `AssistantAccessPolicy.swift` turns that state
plus download status into allowed, sign-in-required, or cannot-stream results.

Identity rules:

- `serverBrowsing`: chosen identity may use cached entity data and may attempt streaming when
  credentials are present.
- `downloadedSessionOnly`: remembered identity remains available, but only its downloaded catalog
  rows may resolve or play.
- anonymous `downloadedOnly`: Assistant is disabled because no Audiobookshelf identity can own the
  request.
- explicit logout: user becomes null and catalog/Spotlight content is removed even though device
  downloads remain on disk.

## Native bridge files

- `src/native/assistant/AssistantBridge.swift`: Expo module functions/events; shortcut refresh and
  Spotlight calls.
- `src/native/assistant/AssistantActionDispatcher.swift`: serialization, pending slot, continuations,
  busy rule, and timeout.
- `src/native/assistant/AssistantBridge.types.ts`: the cross-language request/result contract.
- `src/native/assistant/AssistantBridgeModule.ts`: iOS native-module loader.
- `src/native/assistant/AssistantBridgeModule.web.ts`: no-op web implementation.
- `src/native/assistant/AssistantBridge.kt`: no-op Android implementation.
- `src/native/assistant/index.ts`: TypeScript exports.

The module is compiled in the main app target through the existing `src/native` inline-module setup;
there is no App Intents extension target.

## Tests and verification

Validation recorded on 2026-09-17 at `5305c7a` plus this documentation change:

- Focused Jest command below: **passed** — 6 suites, 48 tests.
- `npx tsc --noEmit`: **passed**.
- Focused ESLint over the new Assistant TypeScript/settings/catalog files: **passed with four
  warnings** in the catalog test's Jest `require()` calls and no errors.
- Repository-wide `npm run lint`: **failed with 50 errors and 43 warnings** in the broader existing
  codebase, principally the React 19 hooks/ref rules activated by the Expo 57 toolchain. Do not
  represent the branch as globally lint-clean; the focused Assistant files are not the source of
  those errors.

Automated tests added with the feature:

- `src/assistant/assistant-action-handlers.test.ts`
- `src/assistant/assistant-bookmark-title.test.ts`
- `src/assistant/assistant-identity.test.ts`
- `src/assistant/assistant-text.test.ts`
- `src/data/sqlite/__tests__/assistant-catalog-writes.test.ts`
- additions to `src/auth/__tests__/enter-user-session.test.ts`

Before handing this branch forward, run:

```sh
npm test -- --runInBand \
  src/assistant/assistant-action-handlers.test.ts \
  src/assistant/assistant-bookmark-title.test.ts \
  src/assistant/assistant-identity.test.ts \
  src/assistant/assistant-text.test.ts \
  src/data/sqlite/__tests__/assistant-catalog-writes.test.ts \
  src/auth/__tests__/enter-user-session.test.ts
npx tsc --noEmit
npm run lint
```

Then build an iOS development client and execute the Phase 10 device matrix in
`assistant-actions-implementation-plan.md`. Native App Intent discovery and schema routing cannot be
accepted from Jest or the simulator alone.

## Upgrade work included in the branch

The first commit in this range upgraded Expo and is required by the iOS 27 schema implementation:

- `package.json` and `package-lock.json`: Expo 57, React Native 0.86.3, matching Expo modules, and
  `expo-modules-jsi`.
- `app.json`: name/version/deployment-target changes and the deployment-target config plugin.
- `plugins/with-ios-deployment-targets.js`: keeps the app, Pods, widget, Readium, and inline native
  modules on compatible deployment targets.
- `patches/expo-widgets+57.0.19.patch`: ports the existing widget patch to Expo 57.
- `patches/react-native+0.86.3.patch`: renames the unchanged React Native patch for the new version.
- `src/shared/ui/organisms/dropdown/index.tsx`: Expo 57 compatibility adjustment.

Treat regressions in widgets, CarPlay, dropdowns, Readium, or transcription as possible upgrade
regressions even when they are not directly caused by Assistant code.

## Commits in scope

| Commit | Purpose |
| --- | --- |
| `aa86d20` | Upgrade to Expo 57, establish ADR/domain language, and write the implementation plan. |
| `dd5f58d` | Publish auth/access/database runtime context to native code. |
| `993f93c` | Prove cold-launch App Intent completion through the native bridge. |
| `5305c7a` | Replace the spike with production actions, catalog, schemas, Spotlight, Settings UI, and tests. |

## Recommended next-session order

1. Read this handoff, ADR-0040, and the Phase 10 matrix; use the implementation plan only for deeper
   rationale.
2. Run the focused tests, TypeScript, and lint commands above and record any failures before editing.
3. Build the iOS app and verify Shortcuts discovers production actions, not `Playback Spike`.
4. Complete the physical-device matrix across the available OS versions. Record the actual OS/device
   used for every schema assertion.
5. Fix failures within the existing boundaries: Swift reads only the Assistant Catalog, TypeScript
   owns its writes, and playback-changing actions go through the bridge to existing domain services.
6. Decide separately whether the unimplemented main-player Siri tip belongs in this release. Keep
   Control Center/Action Button work deferred unless ADR-0040 is explicitly superseded.
