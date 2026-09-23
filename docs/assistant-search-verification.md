# Assistant search execution and verification record

Plan: [assistant-search-implementation-plan.md](./assistant-search-implementation-plan.md).
Update this file as packages complete. Keep concise evidence and references to durable artifacts;
replace stale pending notes rather than appending repeated progress narratives.

## Planning record — 2026-09-18

- Request: prepare a detailed, token-efficient plan for Sol/Terra implementation with independent
  coordinator verification; ask clarification questions and document the work.
- Reviewed baseline: `5305c7a`, branch `codex/assistant-actions`.
- Existing working changes before this task: modified `docs/index.md`; untracked
  `docs/assistant-surfaces-handoff.md`. These were preserved. One new index link was added.
- Read ADR-0040, Assistant surfaces domain rules, handoff, native actions/entities/reader/indexer,
  query/projection source, bridge/startup entry points, app search, and package test conventions.
- Prior research in this conversation checked primary Apple documentation and installed SDK
  declarations. Relevant sources are linked in the plan.
- Used the writing-for-agents skill to bound work packages, limit context loading, and define
  objective completion criteria.
- Findings incorporated: generic-only indexing; capped counts; misleading Title label; query
  ambiguity collapse; source/handoff result-limit mismatch; no in-app search intent; active-Library
  versus all-Library scope mismatch; existing domain rule must change with ambiguity behavior.
- Produced the plan and this evidence template. No product code changed, no implementation agents
  dispatched, no commits or GitHub issues created. Runtime/build/Siri tests were not run for this
  documentation-only task.
- Documentation checks: all relative links in both new documents resolve; `git diff --check`
  passed. Reviewed new-file contents separately because ordinary `git diff` excludes untracked files.

## Decisions

| Topic | Current status |
| --- | --- |
| OS minimum | Changed 2026-09-20: floor raised to iOS 17.4 (ADR-0040 amendment). Interactive Play/Open in search results require iOS 26 `SnippetIntent` + `#available` in `AppShortcutsProvider`, which needs a 17.4 target. iOS 17–25: search intents stay in the Shortcuts app but have no Siri phrases (the builder has no `else`/`#unavailable` branch). |
| General search UX | Locked: prefer a spoken/list Assistant Reply and offer app results; system in-app search necessarily opens the app. |
| Catalog scope | Changed 2026-09-22 (user decision): the Assistant Catalog still *stores* every cached audiobook Library for the identity, but Siri search, author search, play-by-name, Suggested Assistant Books, and Spotlight *read* only the Active Library. Reason: results from another Library played a book outside the open Library, which was confusing; most users have one Library. Direct-id open/play and Resume stay identity-scoped. No Active Library → “Open LAABS Audio and choose a library first.” Superseded: “every cached Library … including retained downloads”. |
| Test device | User-run physical device on 2026-09-20. Model/OS/Siri language/Apple Intelligence not yet recorded. Agent Siri checks remain NOT RUN. |
| Author metadata | P0 recommends combined-credit-only for the current contract. Individual `authors: {id,name}[]` exist in ABS detail types but are discarded by the summary projection; retained downloads cannot guarantee member identities. |
| App results route | Changed 2026-09-22: Siri search opens the existing `(tabs)/search` tab with the spoken text prefilled (`SearchBarCommands.setText` + `SearchSessionStore.setSearchText`). The dedicated `assistant-search-results` route and `queryAssistantCatalog` bridge read from the first P4 pass are removed; with Active-Library scope the Search tab is no longer narrower than Siri. Downloaded-only sessions (Search tab redirects Home) discard the pending search. |

## Package status

Use status PLANNED / IN PROGRESS / READY FOR REVIEW / VERIFIED / NEEDS FIXES.
Record source implementation and device acceptance separately when the latter is unavailable.

| Package | Implementer | Status | Coordinator verdict | Evidence |
| --- | --- | --- | --- | --- |
| P0 Baseline | Sol | VERIFIED | PASS (source); native metadata NOT RUN; Siri user-run recorded | [P0 evidence](#p0-evidence--2026-09-19) |
| P1 Query contract | Coordinator | VERIFIED | PASS (source); app build/Siri NOT RUN | [P1 evidence](#p1-evidence--2026-09-20) |
| P2 Property queries | — | PLANNED | NOT RUN | — |
| P3 Author and replies | Coordinator | VERIFIED | PASS (source + user-run iOS 27 device, 2026-09-21) | [P3 evidence](#p3-evidence--2026-09-20), [P3 snippet fix](#p3-interactive-snippet-fix--2026-09-21) |
| P4 App results | — | READY FOR REVIEW | Source implemented (Active-Library revision 2026-09-22); Siri/device NOT RUN | [P4 evidence](#p4-evidence--2026-09-21), [P4 Active-Library revision](#p4-active-library-revision--2026-09-22) |
| P5 Schemas and indexing | — | PLANNED | NOT RUN | — |
| P6 Acceptance | — | PLANNED | NOT RUN | — |

## Evidence template for each package

Copy once for the assigned package, filling only applicable fields.

- Package / implementer / date / start and end commit (or working-tree diff):
- Files changed and material decisions:
- Commands, exit codes, and concise results:
- Native build configuration and metadata evidence:
- Device configuration / executor (agent or user) / evidence location:
- Baseline failures versus introduced failures:
- Coordinator independent checks:
- Findings and disposition:
- Source/build status: PASS / FAIL / NOT RUN.
- Siri/device status: PASS / FAIL / NOT RUN.
- Remaining dependency or limitation:

## P3 evidence — 2026-09-20

- Package / implementer / date / working-tree: P3 / coordinator / 2026-09-20 / uncommitted on `codex/assistant-actions` from `5305c7a`. No commit.
- Files: `AssistantAuthorEntity.swift`; `AssistantCatalogReader.swift` author query/lookup (P1); `BooksByAuthorIntent.swift` (legacy String + `BooksByAuthorEntityIntent`); `AssistantLibrarySearchSupport.swift`; `IsBookInLibraryIntent.swift` Search label + true-count replies; `AssistantShortcuts.swift`; `AssistantSnippetViews.swift`; `OpenAssistantBookIntent.swift` (`OpenAssistantBookActionIntent` for iOS 16.4); `AssistantBookEntity.detailURL`; `settings-siri-shortcuts-screen.tsx` phrases; harness search/author copy coverage.
- Material decisions: contract v1 keeps combined-credit authors (`userId|normalized`); entity phrases interpolate `AssistantAuthorEntity`; legacy String action retained with distinct title `Find Books by Author`; stale author IDs do not fall back to name search; Play/Open snippet buttons require iOS 17 `Button(intent:)` and are omitted on 16.4 (spoken list still works); Show results deferred to P4; `OpenURLIntent` is iOS 18-only so Open uses a non-discoverable app intent that opens `laabsaudio:///{id}`.
- Commands:
  - `xcrun swiftc src/native/assistant/AssistantDiagnostics.swift src/native/assistant/AssistantRuntimeContext.swift src/native/assistant/AssistantSearchCriteria.swift src/native/assistant/AssistantCatalogReader.swift scripts/test-assistant-catalog.swift -lsqlite3 -o /tmp/test-assistant-catalog && /tmp/test-assistant-catalog` exited 0.
  - `xcodebuild -workspace ios/LAABSAudiobookshelf.xcworkspace -scheme LAABSAudiobookshelf -configuration Debug -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO` exited 0.
- Native metadata (`LAABSAudiobookshelf.app/Metadata.appintents/extract.actionsdata`): `BooksByAuthorEntityIntent` author entity parameter; phrases `Books by ${author} in ${applicationName}` and `What books do I have by ${author} in ${applicationName}`; `BooksByAuthorIntent` String author; `IsBookInLibraryIntent` parameter title `Search`; `AssistantAuthorEntity` present; `OpenAssistantBookActionIntent` not discoverable, `openAppWhenRun` true.
- Device configuration / executor: physical Siri NOT RUN on this working tree. Prior user-run evidence was the old 5305c7a binary.
- Findings and disposition:
  - FIXED for compile: snippet Open no longer references iOS 18 `OpenURLIntent`; `Button(intent:)` gated to iOS 17; `AssistantAuthorEntity` initializes stored properties before `@Property name`.
  - Known platform: “Search Stephen King in LAABS Audio” still likely hits system in-app search until P4. P3’s search path is the prompted shortcut “Find an audiobook in LAABS Audio” / “Search my library in LAABS Audio”.
  - Known limitation: snippet covers still need a local `cover_path`; Play The Shining is entity resolution, not this package.
  - 2026-09-20 device: author/search phrases 1–4 PASS. Snippet Play/Open did nothing; title tap opened the app on the previous/Home screen. Cause: Siri snippet buttons used the ViewBuilder `Button(intent:) { Text }` form and Open called `UIApplication.shared.open` instead of persisting a destination for React Native. Fix in working tree (needs a new device install): `Button("Play"/"Open", intent:)` with parameters assigned after `init()`, `AssistantPendingOpen` + `takePendingOpen` navigation, title is also an Open intent button.
- Source/build status: PASS (harness + app target + extracted metadata).
- Siri/device status: superseded by the 2026-09-21 snippet fix below.
- Remaining: none for P3. Show-results affordance is owned by P4.

## P3 interactive snippet fix — 2026-09-21

- Symptom (user, iOS 27 device, `ddcd22d` build): Play/Open buttons and title tap in Siri search
  results did nothing. Earlier `Button(intent:)` variants, `init(book:)` on the action intents, and
  making the search intents themselves `SnippetIntent` all had no effect.
- Root cause: Siri renders a `ShowsSnippetView` result (`.result(dialog:) { view }`) as a static
  snapshot. `Button(intent:)` only fires when the view is produced by a `SnippetIntent` delivered via
  `.result(dialog:, snippetIntent:)` (`ShowsSnippetIntent`, iOS 26). Every search intent used the
  static path.
- Fix (files): `AssistantLibrarySearchSnippetIntent.swift` (`SnippetIntent`, `[AssistantBookEntity]`
  parameter, renders `AssistantResultSnippet(interactive: true)`);
  `AssistantInteractiveLibrarySearchIntents.swift` (iOS 26-only `SearchLibraryIntent`,
  `SearchBooksByAuthorIntent`, `SearchBooksByAuthorNameIntent` returning `ShowsSnippetIntent`);
  `AssistantLibrarySearchSupport.presentInteractiveLibrarySearch`; `AssistantSnippetViews.swift`
  `interactive` flag so the legacy static card no longer shows dead buttons;
  `AssistantShortcuts.swift` routes the three search phrases to the iOS 26 intents inside
  `if #available(iOS 26.0, *)`.
- Platform constraint: `AppShortcutsBuilder` accepts `if #available` only with deployment target
  ≥ 17.4, and has no `else` / `#unavailable` form (verified against the iOS 27 SDK swiftinterface and
  with `swiftc -typecheck`). Floor raised 16.4 → 17.4 in `app.json`, `ios/Podfile`,
  `ios/Podfile.properties.json`, pbxproj; ADR-0040 amended. Consequence: on iOS 17–25 the legacy
  `IsBookInLibraryIntent` / `BooksByAuthorIntent` / `BooksByAuthorEntityIntent` remain in the
  Shortcuts app but have no Siri phrases.
- Build: `xcodebuild … -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`
  exit 0. `extract.actionsdata`: `AssistantLibrarySearchSnippetIntent` has
  `com.apple.link.systemProtocol.Snippet`, introduced 26.0; the three search intents introduced 26.0
  own the phrases in `root.ssu.yaml`.
- Siri/device status: **PASS** (user-run, iOS 27 physical device, 2026-09-21): Play starts the
  chosen book; Open, cover tap, and title tap land on that book's detail screen.

## P4 evidence — 2026-09-21

- Package / implementer / date / working-tree: P4 / uncommitted on `codex/assistant-actions`. No commit.
- SDK check: installed iOS 27 `AppIntents.swiftinterface`. `ShowInAppSearchResultsIntent` and
  `StringSearchCriteria` are iOS 17.2. `.system.search` (schema name `ShowInAppSearchResultsIntent`)
  is deprecated in 27.0: “Use .system.searchInApp instead”, which is `SystemSearchInAppIntent`
  (`@available(anyAppleOS 27.0, *)`). iOS 27 rejects extra parameters on the protocol, so the system
  intents carry only `criteria`. Show all results is a separate non-discoverable
  `OpenAssistantSearchResultsIntent` that stores `{ query?, authorCredit?, authorExact, userId }`.
- Files: `AssistantPendingSearch.swift`, `AssistantCatalogBridge.swift`,
  `intents/ShowAssistantInAppSearchIntent.swift` (protocol intent plus iOS 27
  `@AppIntent(schema: .system.searchInApp)`), snippet `totalCount` / Show all results,
  `AssistantBridge` peek/take/query, `src/app/assistant-search-results.tsx`,
  `src/components/assistant/assistant-catalog-results-screen.tsx`, startup hold in `_layout.tsx`.
- Material decisions: dedicated root route, not the Search tab. Native reads stay paged through
  the existing `AssistantCatalogReader.query` (limit/offset already tested). Session id is
  rechecked before display and before each page; a different account discards the pending search.
  Startup playback restore yields when a search destination is waiting. Downloaded-session scope
  stays inside the reader (`downloadedSessionOnly`), labeled “Downloaded books”.
- Commands: `npx tsc --noEmit` exit 0. Focused Jest (destination, open-destination, route gate,
  results screen) exit 0. Native catalog harness not re-run; the reader’s paging SQL did not change.
- Native build: `xcodebuild` Debug simulator, `CODE_SIGNING_ALLOWED=NO`, exit 0.
  `extract.actionsdata`: `ShowAssistantInAppSearchIntent` has
  `com.apple.link.systemProtocol.ShowInAppStringSearchResults`, introduced 17.4, obsoleted 27.0,
  parameter `criteria` only, `openAppWhenRun` true, not discoverable.
  `SearchInAppSchemaIntent` has the same search protocol plus `AssistantIntent`, introduced 27.0,
  parameter `criteria` only. `OpenAssistantSearchResultsIntent` is not a system protocol;
  parameters `query`, `authorCredit`, `authorExact`.
- Siri/device status: NOT RUN. “Search Stephen King in LAABS Audio”, “Show full search results”,
  and “Cold launch search” stay NOT RUN until a physical iOS 27 run.
- Remaining: physical cold launch, warm app, session switch, and downloaded-session-only.

## P4 Active-Library revision — 2026-09-22

- Trigger (user): a Siri result from a different Library played a book outside the open Library and
  was confusing; most users have one Library. Decision: Siri reads only the Active Library and app
  results open the normal Search tab. Catalog *storage* is unchanged.
- Native (Swift): `AssistantRuntimeContext.libraryId` (optional; legacy persisted JSON still
  decodes). `AssistantCatalogReader.readInLibrary` binds `AND library_id = ?` for `query`,
  `authors`, `author(byID:)`, `search`, `booksByAuthor`, `playbackMatch`, `suggested`, `all`;
  `book(byID:)`, `book(libraryItemID:)`, `mostRecent()` stay user-scoped. New cases
  `AssistantCatalogRead.libraryRequired`, `AssistantCatalogReadAuthors.libraryRequired`,
  `AssistantPlaybackMatch.libraryRequired`, `AssistantLibrarySearchOutcome.libraryRequired`; copy
  `AssistantSearchCopy.libraryRequired()` = “Open LAABS Audio and choose a library first.”
  `AssistantPendingSearch` payload is `{ query, userId, libraryId }`; `OpenAssistantSearchResultsIntent`
  has one `query` parameter; `AssistantLibrarySearchResults` is `dialog, heading, books, totalCount,
  query`. Removed `Function("queryAssistantCatalog")`; deleted `AssistantCatalogBridge.swift`.
- JS: `createAssistantRuntimeContext` publishes `libraryId` from `activeLibraryId`;
  `startAssistantRuntimeContextSubscription` calls `refreshSuggestedBooks()` + `reindexSpotlight()`
  when the published `libraryId` changes. `assistant-search-destination.ts` reduced to parse +
  `resolveAssistantSearchDelivery` (`none` / `wait` / `discard` / `navigate`; `discard` on user or
  Library mismatch or non-authenticated session). `use-assistant-search-navigation.ts` sets
  `SearchSessionStore.searchText` and `router.navigate("/(tabs)/search")`; the Search tab pushes store
  text into the native bar via `SearchBarCommands.setText` (one `requestAnimationFrame` retry).
  Deleted `src/app/assistant-search-results.tsx` and `src/components/assistant/`; `_layout.tsx`
  startup hold/yield logic, `authenticated-route-state.ts`, and `book-links.ts` route entries reverted.
- Commands: Swift harness (command in P1 evidence) exit 0, “Assistant catalog query tests passed.”
  — new assertions: lib-2 rows excluded from search/author/suggested/all and author bookCount;
  `playbackMatch` `.unique` despite a cross-Library duplicate title; direct-id reads still return lib-2
  rows; `libraryId: nil` → `.libraryRequired`; legacy context JSON decodes. `npx tsc --noEmit` exit 0.
  `npm test -- --runInBand src/navigation src/assistant` exit 0 (8 suites, 60 tests). Integrated
  re-run of both after merging halves: exit 0 / exit 0.
- Native build: `xcodebuild` Debug simulator, `CODE_SIGNING_ALLOWED=NO`, exit 0 on the Swift half
  and exit 0 (`** BUILD SUCCEEDED **`) on the integrated tree. `extract.actionsdata`: `OpenAssistantSearchResultsIntent`
  parameters `['query']`; `AssistantLibrarySearchSnippetIntent` `['heading','books','totalCount','query']`.
- Siri/device status: NOT RUN. Checklist in `assistant-search-next-phase-handoff.md` → P4.
- Known by design: audiobook search with a podcast Active Library returns nothing; downloaded-only
  sessions discard the pending search (Search tab redirects Home).

## Door A phrase revision + Open race — 2026-09-22

- Removed App Shortcut phrases that interpolate an App Entity (`Books by ${author}`, `Play ${book}`).
  Those slots only resolved `suggestedEntities()` (top 25). `SearchBooksByAuthorIntent` and
  `BooksByAuthorEntityIntent` stay for saved shortcuts but are not discoverable.
- Door A search phrases now all use a free-text follow-up (`SearchLibraryIntent`,
  `SearchBooksByAuthorNameIntent`). Empty results store `AssistantPendingSearch` and offer
  `requestToContinueInForeground` to open the Search tab.
- Open-from-card flake: `useAssistantOpenNavigation` no longer `take()`s before a retry window.
  AppState can become active before `OpenAssistantBookActionIntent.perform()` writes UserDefaults;
  retries at 50/150/400/800ms catch the late store. `rememberAssistantOpenInFlight` keeps the
  startup route-gate hold after take so Home does not win the race.

## P1 evidence — 2026-09-20

- Package / implementer / date / working-tree: P1 / coordinator / 2026-09-20 / uncommitted on `codex/assistant-actions` from `5305c7a`. No commit.
- Files: `AssistantSearchCriteria.swift` (criteria, result, playback match); `AssistantCatalogReader.swift` (word-prefix SQL, COUNT+page on one snapshot); generic/Books/Audio entity queries and AudioSearch; play dialogs; `CONTEXT.md` ambiguity rule; `scripts/test-assistant-catalog.swift`; `src/assistant/__fixtures__/assistant-search-match-fixtures.json`.
- Material decisions: combined-credit author equals/contains; every normalized token is a word prefix on `search_text`; punctuation-only / SQL-wildcard input matches nothing; unique exact title may resolve for playback; duplicate titles and four-or-more matches stay ambiguous; `matchedFromMany` autoplay removed.
- Commands: `xcrun swiftc src/native/assistant/AssistantDiagnostics.swift src/native/assistant/AssistantRuntimeContext.swift src/native/assistant/AssistantSearchCriteria.swift src/native/assistant/AssistantCatalogReader.swift scripts/test-assistant-catalog.swift -lsqlite3 -o /tmp/test-assistant-catalog && /tmp/test-assistant-catalog` exited 0 (“Assistant catalog query tests passed.”). Focused Jest `assistant-text`, `assistant-identity`, `assistant-catalog-writes` exited 0 (18 tests). Native app build / App Intents metadata NOT RUN. Siri NOT RUN for P1.
- Coordinator independent checks (2026-09-20, Opus): re-ran the Swift harness command above from a
  clean shell (exit 0, “Assistant catalog query tests passed.”) and the three focused Jest suites
  (exit 0, 3 suites / 18 tests, only the pre-existing Watchman recrawl warning). Read the whole
  working-tree diff. Confirmed every read still applies `user_id` plus `downloadedSessionOnly`
  (`AssistantCatalogReader.swift:296-311, 358-365`); all catalog values are bound parameters and
  `escapeLike` covers `%`, `_`, `\` (`:580-585`); COUNT and the page share one predicate and one
  connection (`:400-415`); `search_text` written by `assistant-catalog-writes.ts` covers title,
  subtitle, author, series, and narrator, matching the word-prefix contract; no `matchedFromMany`
  reference survives anywhere in the tree; the `CONTEXT.md` ambiguity rule now forbids best-of-many
  autoplay and matches `playbackMatch` (`AssistantCatalogReader.swift:203-225`).
- Findings and disposition:
  - FIXED: empty author tokens now match nothing. `combinedCreditContains` / `combinedCreditEquals`
    whose normalized value is empty append `AND 0`, same as punctuation-only text. Harness asserts
    `.combinedCreditContains("%%%")` and `.combinedCreditEquals("!!!")` yield `totalCount == 0`.
    Re-ran `xcrun swiftc ... && /tmp/test-assistant-catalog` after the fix (exit 0).
  - Minor: no action boundary distinguishes `.unavailable` from an empty success.
    `IsBookInLibraryIntent.swift:25` and `BooksByAuthorIntent.swift:25` still call the legacy
    `[AssistantBookRow]` helpers, so an old/missing contract speaks the same “no books” reply as a
    genuine zero-result search. `AssistantCatalogRead` exists but has no consumer.
  - Minor: `playbackMatch` collapses `exactTitles` computed from the current page only, and reports
    `totalCount: exactTitles.count` (`:214-216`), which undercounts when more than `limit` editions
    share a title.
  - Minor: `playbackMatch` is the only public reader entry point with no `AssistantDiagnostics`
    request, so the P0 correlation logging has a hole on the playback path.
  - Minor: `assistant-search-match-fixtures.json` is read only by the Swift harness; no TypeScript
    app-search test consumes it, so the “shared fixtures” intent is not yet cross-checked.
  - Minor: COUNT and page are two statements on one connection with no enclosing read transaction,
    so they are consistent in practice but not a guaranteed snapshot under a concurrent writer.
  - Unrelated pre-existing working-tree changes in `book-action-menu.tsx` and `book-list-item.tsx`
    were preserved and are outside P1.
- Source/build status: PASS (Swift harness + focused TS, both re-run independently). App target build
  and App Intents metadata extraction NOT RUN.
- Siri/device status: NOT RUN. No device access in this review; this is not evidence of a source failure.
- Smallest follow-up: none for P1 source. P3 should consume `totalCount` and `AssistantCatalogRead`
  at action boundaries. P2 maps property queries onto this criteria type.
- Remaining: P3 should consume `totalCount` in author/search replies and adopt `AssistantCatalogRead`
  so unavailable catalogs read differently from empty ones; P2 property queries map onto this criteria type.

## P0 evidence — 2026-09-19

- Package / implementer / start: P0 / Sol / `5305c7a47860fd59e1c5fe8538d065531039564b`
  on `codex/assistant-actions`. End is the working-tree diff; no commit was created.
- Pre-existing working tree: modified `docs/index.md`; untracked
  `docs/assistant-search-implementation-plan.md`, this verification record, and
  `docs/assistant-surfaces-handoff.md`. These were preserved.
- Files changed: `AssistantDiagnostics.swift` adds DEBUG-only structured query completion logs;
  `AssistantCatalogReader.swift` emits request id, query name, input kind, bounded result count,
  duration, and outcome without recording query text, credentials, or catalog contents.
- Focused baseline checks (delegated to Opus): direct package-runner commands hit an internal
  approval-plumbing error, so the equivalent local binaries were run once:
  `node ./node_modules/jest/bin/jest.js --runInBand` with the six handoff test files exited 0
  (6 suites, 48 tests); `node ./node_modules/typescript/bin/tsc --noEmit` exited 0 with no
  diagnostics. The only noise was a pre-existing Watchman recrawl warning. No baseline failures.
- Locked decisions: iOS 16.4 remains the floor; general search favors a native spoken/list reply
  with an app-results option; scope is every cached audiobook Library for the selected identity,
  including retained downloads.
- P1 interface proposed in `AssistantCatalogReader.swift`: `AssistantSearchCriteria` with optional
  text, `AssistantAuthorCriterion` (`combinedCreditContains` or `combinedCreditEquals`),
  downloaded/finished filters, allowlisted deterministic sort, limit, and offset;
  `AssistantSearchResult` with `[AssistantBookRow]` and `totalCount`. Trusted runtime context supplies
  user/access scope. Query and count must share one SQLite read snapshot.
- P1 native tests: follow `scripts/test-read-along-highlight.swift` with a small independent
  `scripts/test-assistant-catalog.swift` harness that creates a temporary v1 SQLite catalog,
  publishes a runtime context, and invokes the real reader. Proposed command:
  `xcrun swiftc src/native/assistant/AssistantDiagnostics.swift src/native/assistant/AssistantRuntimeContext.swift src/native/assistant/AssistantCatalogReader.swift scripts/test-assistant-catalog.swift -lsqlite3 -o /tmp/test-assistant-catalog && /tmp/test-assistant-catalog`.
- Author audit / P3 recommendation: keep combined-credit-only semantics in contract v1.
  `library_catalog_items.author` and `assistant_catalog.author` are combined strings.
  `summary_json` is the serialized `LibraryItemSummary`, whose adapter in
  `src/api/library-items-api.ts` keeps `authorName` but discards ABS
  `MediaMetadata.authors: {id,name}[]`. If individual identity becomes required, version the
  projection and change `library-items-api.ts`, `catalog-refresh.ts`, `shadow-db-core.ts`,
  `assistant-catalog-writes.ts`, `assistant-downloaded-books.ts`, and
  `AssistantCatalogReader.swift`. Retained details may carry `metadata.authors`, but older/fallback
  downloads can supply only `authorName`; do not split combined display names. Under v1, P3's
  `AssistantAuthorEntity` should represent one distinct combined credit with a session-scoped
  `userId|normalizedCredit` id and route its value to `combinedCreditEquals`; its UI must not claim
  that a coauthor string is one person.
- App-results audit / P4 recommendation: add root route
  `src/app/assistant-search-results.tsx` and controller
  `src/components/assistant/assistant-catalog-results-screen.tsx`; expose bounded P1 reads through
  `AssistantBridge.swift`, `AssistantBridge.types.ts`, `AssistantBridgeModule.ts`/`.web.ts`, and
  `index.ts`; classify the route in `src/navigation/authenticated-route-state.ts` and integrate
  one-shot cold-launch delivery in `src/app/_layout.tsx`. Reuse `BookListItem` presentation with
  assistant-scoped open/play handlers. This is smaller than broadening the Search tab because
  `src/app/(tabs)/search/index.tsx` and its repositories assume the Active Library and authenticated
  browsing, which would conflict with all-Library and retained-download scope.
- Baseline phrase evidence, user-run 2026-09-20 (spoken replies, not our exact dialog strings):
  - “What books do I have by Stephen King in LAABS Audio?” → “I couldn't find any audiobooks by Stephen King in LAABS Audio.” Not `BooksByAuthorIntent` (“I couldn't find books by … in your LAABS Audio library.”). Likely system/schema author Find, not the App Shortcut.
  - “Play The Shining in LAABS Audio” → “I couldn't find The Shining in LAABS Audio.” Not the play `notFound` dialog (“I couldn't find that audiobook in your LAABS Audio library.”). Likely entity resolution against Suggested Assistant Books / index, not a catalog substring search.
  - “Search Stephen King in LAABS Audio” → “I can't search for Stephen King in LAABS Audio because the app doesn't support in-app search.” System in-app search route; P4 is unimplemented. Did not hit “Search my library in LAABS Audio”.
  - “Play LAABS Audio” / “Resume LAABS Audio”: user reports hit-and-miss. Works sometimes only if the app is already open; otherwise playback can start after ≥45s. Native pending-action timeout is 10s, so late audio is probably cold launch plus ordinary restore after the assistant request expired, not a successful drain.
  - Discriminating shortcuts, same device: “Find books by an author in LAABS Audio” (author prompted as Stephen King) returned multiple King books. “Find an audiobook in LAABS Audio” returned books. Assistant Catalog and session are populated; natural-language routing is the failure. Snippet rows showed no cover art (placeholders). Covers in snippets only load from a local `cover_path` (download or widget artwork cache); `AsyncImage` of `cover_url` is unreliable in Siri snippets.
- Source/build status: PASS for focused TS; native App Intents metadata extraction NOT RUN.
- Siri/device status: user-run FAIL on natural phrases; PASS on prompted App Shortcuts; Play/Resume cold-launch FAIL. Agent device checks NOT RUN.
- Remaining: P1 interfaces locked. Native metadata remains a later build gap, not a P1 blocker.

## Phrase and behavior matrix

Use actual catalog titles/authors when the examples are absent. Record the exact utterance, selected
intent/query, resolved arguments, visible/spoken outcome, and pass/fail per test configuration.
Suggested and non-suggested entities must be separate test cases.

| Case | Expected result | Status |
| --- | --- | --- |
| What books do I have by Stephen King in LAABS Audio? | Author supplied in first utterance; correct total and bounded list | FAIL (user, 2026-09-20): system/schema empty-author reply; did not use App Shortcut dialog |
| Books by Stephen King in LAABS Audio | Same author criteria and result set | PASS (user, 2026-09-20): prompted “Find books by an author…” returned multiple King books; covers missing |
| Result-card Play / Open / cover / title tap | Play starts that book; Open lands on its detail | PASS (user, iOS 27, 2026-09-21) after `SnippetIntent` fix; iOS 17–25 static card, NOT RUN |
| Author outside suggestion set | Modern route resolves or limitation explicitly documented | NOT RUN |
| Author with coauthored books | Membership behavior matches declared metadata semantics | NOT RUN |
| Author with >10 matching books | True total; at most five spoken and ten shown | NOT RUN |
| Search Stephen King in LAABS Audio | Correct author-inclusive results; record Siri versus app route | FAIL (user, 2026-09-20): system in-app search; “app doesn't support in-app search” |
| Search The Shining in LAABS Audio | Correct title results; no playback | NOT RUN |
| Show full search results | Query, filters and all-Library scope retained | NOT RUN |
| Play The Shining in LAABS Audio | Unique correct identity plays | FAIL (user, 2026-09-20): Siri could not resolve the title; play dialog did not run |
| Play a title outside suggested books | Verify schema/catalog discovery separately | NOT RUN |
| Duplicate title/edition | Ask for choice, never arbitrary best-match autoplay | NOT RUN |
| Broad play request with >3 matches | Clarify; discovery does not collapse to one | NOT RUN |
| Cancel disambiguation | No playback or pending action remains | NOT RUN |
| Play LAABS Audio / Resume LAABS Audio | Existing resume behavior retained | FAIL (user, 2026-09-20): works only if app already open; cold path ≥45s delay |
| Query with zero results | Honest empty reply; no fabricated count | NOT RUN |
| Catalog unavailable/old contract | Distinct actionable failure rather than false “no books” | NOT RUN |
| Cold launch search | Destination and query survive; playback unchanged | NOT RUN |
| Cold launch play | Existing pending action and audible-result behavior retained | NOT RUN |
| Session switch/logout during operation | No stale results, playback, or indexed content | NOT RUN |
| Offline / downloaded-session-only | Existing read/play access rules honored | NOT RUN |
| Retained download absent from server catalog | Search/open/play remain supported where allowed | NOT RUN |
| Results in a non-active Library | Correct open/play; no silent result narrowing | NOT RUN |
| Legacy saved author/search shortcut | Remains runnable after update | NOT RUN |
| Pause / Bookmark Here / sleep timer | No integration regressions | NOT RUN |
| App name omitted | Exploratory; record app-selection behavior | NOT RUN |
| Play the second one | Exploratory; no release guarantee | NOT RUN |

Test at least one actual older supported Siri configuration and one available Siri AI configuration
before claiming both experiences are accepted. Compile/availability checks cover unsupported local
runtimes only at the code level. Mark unavailable devices NOT RUN; never infer a pass.

## Final release evidence

- Integrated commit/build:
- Focused test/typecheck/lint/native-build results:
- Configurations actually tested:
- Core phrase outcomes and known platform limitations:
- Documentation/settings/NEW_FEATURES updates where applicable:
- Coordinator verdict and remaining acceptance gaps:
