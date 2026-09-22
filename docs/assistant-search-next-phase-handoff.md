# Assistant search — next-phase handoff

Last updated: 2026-09-21
Branch: `codex/assistant-actions`
State at handoff: P0, P1, P3 complete and device-verified on iOS 26. P2, P4, P5, P6 not started.

Read in this order, then start P4 (recommended) or P2:

1. This file.
2. [`assistant-search-verification.md`](./assistant-search-verification.md) — decisions table,
   package status, evidence for each finished package, phrase matrix. Update it as you go.
3. [`assistant-search-implementation-plan.md`](./assistant-search-implementation-plan.md) — the P0–P6
   work packages. Only the P2, P4, P5, P6 sections are still live instructions.
4. [`ADR-0040`](./adr/0040-assistant-actions-live-in-the-app-target-over-an-assistant-catalog.md)
   (including the 2026-09 amendment) and the **Assistant surfaces** section of
   [`CONTEXT.md`](../CONTEXT.md) — design authority.
5. [`assistant-surfaces-handoff.md`](./assistant-surfaces-handoff.md) — module map and architecture
   for the whole Siri/Shortcuts/Spotlight feature. Its file table for Find/Books-by-author predates
   P3; use the map below for search.

## What changed in the last session (and why it matters next)

### iOS floor is now 17.4

`app.json` → `expo.ios.deploymentTarget: "17.4"`. Also written into `ios/Podfile`,
`ios/Podfile.properties.json`, and the pbxproj so the checked-in `ios/` folder does not need
`expo prebuild`. If you do run prebuild, `plugins/with-ios-deployment-targets.js` regenerates the Pod
post-install hook from `app.json`.

Reason: interactive Siri snippets need `if #available(iOS 26.0, *)` inside
`AppShortcutsProvider.appShortcuts`, and `AppShortcutsBuilder` only supports that at target ≥ 17.4.
Verified against the iOS 27 SDK `.swiftinterface` and with `swiftc -typecheck`; there is no `else` or
`#unavailable` form, so shortcuts cannot be routed to a *different* intent on older systems.

Downstream consequences you must respect:

- `@available(iOS 17.0, *)` / `if #available(iOS 17.0, *)` guards are now dead code; remove them when
  you touch a file, do not add new ones.
- On iOS 17–25 the search phrases are **not registered with Siri**. `IsBookInLibraryIntent`,
  `BooksByAuthorIntent`, `BooksByAuthorEntityIntent` still exist (Shortcuts app, saved shortcuts) and
  render the static card. Do not delete them without proving saved shortcuts survive.
- Any doc, comment, or test that says "16.4 floor" is stale. Known remaining mentions:
  `assistant-actions-implementation-plan.md` (historical plan; leave), `assistant-search-verification.md`
  P0/P3 evidence (historical; leave). `CONTEXT.md` does not name the floor.

### How interactive Siri snippets work here (the P3 lesson)

A view returned via `.result(dialog:) { view }` (`ShowsSnippetView`) is a **static snapshot**; any
`Button(intent:)` inside it is drawn but never fires. Interactive controls only work when:

1. The search intent returns `some IntentResult & ProvidesDialog & ShowsSnippetIntent` via
   `.result(dialog:, snippetIntent: SomeSnippetIntent(...))`, and
2. `SomeSnippetIntent: SnippetIntent` (iOS 26) builds the view in its own `perform()`, and
3. The buttons inside that view are `Button(intent: AnotherAppIntent(...)) { label }`.

Concretely:

| Role | File |
| --- | --- |
| Snippet intent (builds the interactive card) | `src/native/assistant/intents/AssistantLibrarySearchSnippetIntent.swift` |
| iOS 26 search intents that return it | `src/native/assistant/intents/AssistantInteractiveLibrarySearchIntents.swift` (`SearchLibraryIntent`, `SearchBooksByAuthorIntent`, `SearchBooksByAuthorNameIntent`) |
| Shared outcome → result helpers | `AssistantLibrarySearchSupport.swift`: `presentLibrarySearch` (static, all OS) and `presentInteractiveLibrarySearch` (iOS 26) |
| Card/list views, `interactive:` flag | `src/native/assistant/AssistantSnippetViews.swift` — buttons render only when `interactive == true` |
| Button targets | `PlayAudiobookIntent(book:)` and `OpenAssistantBookActionIntent(book:)` |
| Phrase routing | `src/native/assistant/AssistantShortcuts.swift` — three search shortcuts inside `if #available(iOS 26.0, *)` |

`AssistantLibrarySearchSnippetIntent` carries `books: [AssistantBookEntity]` as a parameter, so
`AssistantBookEntity`'s `AppEntity` conformance and `EntityQuery` must keep resolving ids; if you
change the entity id format, Siri will fail to rehydrate the snippet.

### Open-from-Siri navigation path

`OpenAssistantBookActionIntent` (all OS) stores the id via `AssistantPendingOpen.store` and opens the
app; on iOS 18+ Spotlight uses `OpenAssistantBookIntent` (`OpenIntent`) → `OpenLAABSIntent`.

JS side:

- `AssistantBridge.swift` exposes `peekPendingOpen()` (non-destructive) and `takePendingOpen()`.
- `src/app/_layout.tsx` folds `peekPendingOpen()` into `startupBookLinkId` so a cold launch lands on
  the book instead of Home, and mounts `useAssistantOpenNavigation`.
- `src/navigation/use-assistant-open-navigation.ts` drains `takePendingOpen()` on mount, on
  `AppState` → active, and on `Linking` `url` events; resolution lives in
  `src/navigation/assistant-open-destination.ts` (tested).

**P4 must reuse this shape** (a persisted, one-shot native destination + startup fold-in + warm-app
listener) for "show results", not the expiring playback pending-action slot in
`AssistantActionDispatcher`.

## Recommended next package: P4 — In-app search results with preserved scope

Plan section: `assistant-search-implementation-plan.md` → **P4**. P0 already made the design call
(verification record, Decisions table + P0 evidence "App-results audit"):

- New root route `src/app/assistant-search-results.tsx` + controller
  `src/components/assistant/assistant-catalog-results-screen.tsx`. Do **not** widen the
  `(tabs)/search` tab — it assumes the Active Library and authenticated browsing, which violates the
  locked all-Library + retained-download scope.
- Bounded native reads exposed through `AssistantBridge.swift` (new `Function`/`AsyncFunction`
  wrapping `AssistantCatalogReader.shared.query(criteria)` with `offset`/`limit`), typed in
  `AssistantBridge.types.ts`, wired in `AssistantBridgeModule.ts` / `.web.ts` / `index.ts`.
  Swift stays read-only; TypeScript stays the only catalog writer.
- Classify the route in `src/navigation/authenticated-route-state.ts` so startup redirects do not
  discard it; deliver once on cold launch via `_layout.tsx`, same pattern as `peekPendingOpen`.
- Reuse `BookListItem` presentation with assistant-scoped open/play handlers that go through existing
  identity/access rules (books outside the active Library and retained downloads included).

Suggested build order inside P4:

1. Native: `AssistantPendingSearch` (mirror `AssistantPendingOpen`: store/peek/take of
   `{ query?, authorCredit?, userId }` in `UserDefaults`), bridge read function for paged catalog
   queries. Add a `ShowInAppSearchResultsIntent` (`isDiscoverable = false`, `openAppWhenRun = true`)
   and check the current SDK for the system in-app-search schema name/availability before
   conforming — do not copy deprecated samples.
2. Add a **Show all results** control to `AssistantResultSnippet` (interactive path only) that
   targets the new intent. Only show it when `totalCount > displayedBookLimit`; this needs
   `totalCount` to flow into `AssistantLibrarySearchOutcome.results` (currently only the dialog
   string sees it).
3. JS: `resolveAssistantSearchDestination`, startup fold-in, warm-app listener, route, controller
   with query/scope label, loading/empty/error states, paging on the bridge read. Revalidate the
   session id before display and on each page; clear on logout/switch.
4. Tests: controller/unit tests for destination resolution and session revalidation; one route
   smoke test; extend `scripts/test-assistant-catalog.swift` if the reader gains paging behavior.
5. Device: cold launch with app killed, warm app, session switch mid-launch, downloaded-session-only.
   Record device/OS in the verification record's phrase matrix ("Show full search results",
   "Cold launch search").

Also in scope for P4 (from the phrase matrix): "Search Stephen King in LAABS Audio" currently hits
the *system* in-app-search route and Siri replies "the app doesn't support in-app search". P4's
intent is what makes that phrase work; record the outcome separately from our own
"Search my library…" phrase.

## Alternative next package: P2 — Property queries

Plan section **P2**. Independent of P4; smaller. Maps `EntityPropertyComparator` filters (author,
title, narrator, series, downloaded, finished) on the generic/Books/Audio entity queries onto
`AssistantSearchCriteria` (`src/native/assistant/AssistantSearchCriteria.swift`), which already has
author equals/contains, downloaded/finished, sort, limit, offset. Author equality must stay honest
about combined credits (contract v1 has no per-person author ids). Evidence: extracted metadata shows
the property queries and a Shortcuts "Find Audiobooks" action filters correctly.

## Then P5 (schema indexing / AudioSearch) and P6 (acceptance)

Unchanged from the plan. P5's "Play The Shining in LAABS Audio" failure (entity resolution against
suggested books only) is the main user-visible gap left after search works. P6 fills the
"Final release evidence" section of the verification record.

## Known issues carried forward (not blocking P4)

- Snippet cover art loads only from a local `cover_path`; `AsyncImage` of `cover_url` is unreliable
  inside Siri. Consider populating `cover_path` from the widget artwork cache during catalog writes.
- `AssistantLibrarySearchOutcome.results` does not carry `totalCount` (see P4 step 2).
- `playbackMatch` in `AssistantCatalogReader.swift` computes exact-title duplicates from the current
  page only and has no `AssistantDiagnostics` request logging (P1 minor findings).
- `.unavailable` vs empty result: legacy intents now route through `AssistantLibrarySearchSupport`
  which distinguishes them; confirm the spoken copy differs (`AssistantSearchCopy.catalogUnavailable`).
- "Play LAABS Audio" / "Resume LAABS Audio" cold-launch: ≥45 s delays observed 2026-09-20. The
  10 s pending-action timeout expires before the RN runtime drains it; playback then comes from
  ordinary restore. Not a search issue; track separately.
- Repository-wide `npm run lint` fails on pre-existing React 19 hooks-rule errors unrelated to
  Assistant files. Compare against baseline, do not chase.

## Commands

```sh
# focused TS
npm test -- --runInBand \
  src/assistant/assistant-action-handlers.test.ts \
  src/assistant/assistant-identity.test.ts \
  src/assistant/assistant-text.test.ts \
  src/data/sqlite/__tests__/assistant-catalog-writes.test.ts \
  src/navigation/assistant-open-destination.test.ts
npx tsc --noEmit

# native reader harness
xcrun swiftc src/native/assistant/AssistantDiagnostics.swift \
  src/native/assistant/AssistantRuntimeContext.swift \
  src/native/assistant/AssistantSearchCriteria.swift \
  src/native/assistant/AssistantCatalogReader.swift \
  scripts/test-assistant-catalog.swift -lsqlite3 -o /tmp/test-assistant-catalog \
  && /tmp/test-assistant-catalog

# app target build + App Intents metadata (≈5–8 min)
xcodebuild -workspace ios/LAABSAudiobookshelf.xcworkspace -scheme LAABSAudiobookshelf \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO \
  > /tmp/laabs-build.log 2>&1; echo $?
# then inspect
#   <DerivedData>/…/Debug-iphonesimulator/LAABSAudiobookshelf.app/Metadata.appintents/extract.actionsdata
#   (actions[*].systemProtocols, availabilityAnnotations) and root.ssu.yaml (phrases → intents).
```

Never pass `IPHONEOS_DEPLOYMENT_TARGET=…` on the `xcodebuild` command line; it overrides every Pod
target and breaks unrelated Swift modules. Change the pbxproj/Podfile instead.

## Working rules for this branch

- Do not commit unless the user asks. When you do, add a `NEW_FEATURES.md` entry at the top.
- Any Siri behavior claim needs a physical iOS 26 device run by the user; simulator and metadata
  extraction prove source/build only. Record device/OS in the verification record.
- Swift reads only the Assistant Catalog; TypeScript owns writes; playback-changing actions go
  through `AssistantActionDispatcher` to existing player services.
- Testing that drives a simulator/device or repro loops is delegated to an Opus agent (see
  `CLAUDE.md`).
