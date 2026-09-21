# Assistant search and Siri implementation plan

Status: P0/P1 source verified; P3 source built with extracted App Intents metadata; Siri on a new device build is next. Prepared 2026-09-18.
Owner: Sol or Terra implements one work package at a time; the coordinating assistant independently verifies each package.
Execution evidence: [assistant-search-verification.md](./assistant-search-verification.md).
Architecture authority: [ADR-0040](./adr/0040-assistant-actions-live-in-the-app-target-over-an-assistant-catalog.md) and `CONTEXT.md`, Assistant surfaces.

## Start here

Read this section, the product contract, and only your assigned package. Consult the existing
[handoff](./assistant-surfaces-handoff.md) for a file map when needed. The original
[implementation plan](./assistant-actions-implementation-plan.md) describes earlier work, not this backlog.

1. Coordinator resolves product decisions below and assigns one package with explicit file ownership.
2. Implementer reads relevant code and records the starting commit and existing dirty files.
3. Implement the package, run its focused checks, and update its execution evidence.
4. Coordinator reviews the diff and verifies acceptance independently. Fix material findings before proceeding.
5. Commit only when requested; every commit must also update `NEW_FEATURES.md` with the date,
   tester-facing summary, and behavior to verify. Include a short hash when available; do not create an amend loop to obtain it.

Use one implementer by default to reduce duplicate context and merge overhead. Sol or Terra is suitable;
use the configured reasoning level unless the coordinator has a reason to change it. The coordinator
handles cross-package decisions and API uncertainty. No implementation is authorized by this document alone.

## Product contract and decisions

Questions sent to the user while preparing this plan:

| Decision | Proposed default; pending response |
| --- | --- |
| Minimum supported OS | Preserve iOS 16.4 and gate newer APIs. |
| General search experience | Prefer a spoken/list Assistant Reply; offer app results. The system in-app-search route necessarily opens results. |
| Search scope | All cached audiobook Libraries for the selected Audiobookshelf User Identity, including retained downloads. |

Unanswered choices remain proposals. They do not block preparing the plan or baseline work;
resolve them before implementing dependent product behavior. A different minimum or catalog scope
requires an explicit update to ADR-0040 and the corresponding domain rules.

Target outcomes:

- “What books do I have by Stephen King in LAABS Audio?” returns the correct count and a bounded list
  in Siri without requiring React Native or a second author prompt when the author resolves.
- “Play The Shining in LAABS Audio” plays a uniquely resolved Assistant Book. Ambiguous editions
  prompt for selection; a broad author query must not silently select one book for playback.
- “Search Stephen King in LAABS Audio” and title searches have a native answer path and a supported
  app-results path. Siri chooses routing; record which experience actually occurs on each configuration.
- “Show results in LAABS Audio” preserves the query, filters, access restrictions, and search scope.
- App-name-free requests and follow-ups such as “play the second one” are exploratory acceptance
  cases, not promises for the first milestone.

Read-only answers use the cached Assistant Catalog, not a live server search. Wording must not claim
completeness across uncached Libraries. Say “I found…”; counts describe matches in the available catalog.
Keep cached read access in supported offline/session states and keep explicit logout disabling access.

## Current implementation and gaps

| Area | Evidence in source | Required change |
| --- | --- | --- |
| General search | `intents/IsBookInLibraryIntent.swift`: String labeled Title, five matches, speaks first | Search label, plural reply, true count, reusable typed results |
| Author search | `intents/BooksByAuthorIntent.swift`: String author, ten alphabetical matches | Resolve author from utterance; retain old action compatibility; true count |
| Shortcut phrases | `AssistantShortcuts.swift`: play interpolates a book; searches have no parameter | Author entity phrases; free-text search uses system search APIs |
| Matching | `AssistantCatalogReader.swift`: normalized contiguous substring, all matching rows sorted | Shared bounded query contract, word-prefix semantics, structured filters |
| App search | `src/data/sqlite/search-expression.ts`: FTS word prefixes, active Library | Preserve assistant scope on app handoff; do not silently reuse narrower results |
| Entity queries | Generic, Books, and Audio wrappers implement string lookup | Structured property queries; preserve multiple candidates |
| Ambiguity | All three wrappers and AudioSearch collapse >3 matches to one | Separate discovery from playback selection |
| Replies | `AssistantSnippetViews.swift`: cards/list without explicit actions | Correct summaries, typed book output, supported open/play/show-results affordances |
| Spotlight | `AssistantSpotlightIndexer.swift` indexes only generic AssistantBookEntity | Validate/index schema-aware representation; clear old types on migration/logout |
| Playback | Generic action, iOS 18 Books schema, iOS 27 Audio schema, existing dispatcher | Retain pipeline; prove routing and entity compatibility |
| In-app search | No ShowInAppSearchResultsIntent | Add gated system search intent and session-safe navigation |
| Test evidence | TS suites exist; physical-device acceptance incomplete | Native query coverage, metadata/build verification, device phrase matrix |

Native filenames above are under `src/native/assistant/`. Source is authoritative: the prior handoff
says general search returns ten, but the actual action requests five.

## Architecture and API constraints

- Swift reads only the Assistant Catalog. TypeScript owns its projection, migrations, rebuilds,
  and patches. Keep existing identity, access policy, pending-action expiry, and playback services.
- Keep native search independent of the React Native runtime. Reuse one native query implementation
  across Assistant Actions, entity wrappers, and any app view of assistant results.
- Prefer small typed criteria and result values over a generic query framework. Keep SQL bindings
  parameterized and sorting/filter fields allowlisted. Apply scope restrictions to every read.
- Conventional App Shortcut phrase placeholders support known entity/enum options, not arbitrary
  String capture. Adding a String interpolation is not the free-text solution.
- EntityPropertyQuery supplies structured filtering and a generated Find action; it does not
  guarantee that Siri maps a particular sentence to EqualToComparator.
- APIs in the installed SDK: EntityPropertyQuery iOS 16; AudioPlaybackIntent iOS 17;
  ShowInAppSearchResultsIntent iOS 17.2; Books schemas/IndexedEntity iOS 18;
  base IntentValueQuery iOS 26; AudioSearch/Audio schemas iOS 27. Verify exact selected symbols
  against the SDK at implementation time. Use @AppIntent/@AppEntity macro names.
- Distinguish protocol availability from Siri AI availability, hardware, language, settings, and
  actual routing. Preserve conventional App Shortcuts as fallback.
- New Audio schema/query types already exist. Verify metadata and runtime invocation before
  rewriting them or asserting they are disconnected; source references alone do not prove discovery.
- The current domain rule explicitly permits best-match autoplay for >3 results. Package P1 must
  update that rule to match the new disambiguation contract; preserve unrelated domain rules.

## P0 — Establish a reproducible baseline and integration choices

Dependencies: none. Owner: implementer; coordinator reviews API choices before P1.
Read: existing handoff verification section, assistant wrappers/indexer, native build configuration.

Work:

1. Record commit, SDK/Xcode, deployment target, build scheme, available devices and Siri configurations.
2. Run existing focused TS suites and typecheck once. Record current failures separately from changes.
3. Build the app using the discovered workspace/scheme/destination; inspect extracted App Intents
   metadata for actions, availability, phrases, entity types, and AudioSearch query discovery.
4. Add lightweight development diagnostics only where needed: request correlation, intent/query name,
   input kind, result count, duration, outcome. Avoid credentials and full user catalog/query logging.
5. Capture baseline behavior for the three target phrases. If no suitable device is available,
   record NOT RUN and complete the source/build work; do not claim Siri routing is verified.
6. Resolve two implementation choices with the coordinator: source of individual author metadata,
   and the smallest app-results route that preserves assistant scope. Record chosen files/interfaces.

Done: repeatable baseline commands, route evidence or explicit gaps, and concrete P1/P3/P4 interfaces.
Do not spend repeated attempts trying to fix unrelated baseline lint errors or Siri platform behavior.

## P1 — Shared query contract, counts, and ambiguity

Dependencies: P0. Own: AssistantCatalogReader.swift, assistant text/fixtures, affected entity-query
adapters, CONTEXT.md ambiguity rule. Projection changes only if justified by the author data audit.

Work:

1. Add a small native criteria type: optional text and author criterion, optional downloaded/finished
   filters, deterministic sort, bounded limit/offset. User/access scope comes from trusted context.
2. Return books plus totalCount from the same predicate and a consistent read snapshot. Distinguish
   unavailable/invalid catalog from a successful search with zero matches at action boundaries.
3. Match normalized query tokens as word prefixes across title/subtitle/author/series/narrator,
   with every token required. Share fixtures with app-search expectations rather than allowing Swift
   to read the app's FTS tables. Keep exact-title ranking first and deterministic ties.
4. Implement total counts and bounded results without loading the whole catalog unnecessarily.
   Prefer simple SQL first; add an assistant-owned index only after a representative measurement.
5. Preserve all plausible candidates in discovery. Playback may automatically select a unique exact
   title; multiple editions remain ambiguous. Use supported system disambiguation; if too many choices
   remain, ask for a narrower title or offer results. Keep “Play LAABS” resume behavior.
6. Apply the policy to generic, Books, and Audio query adapters; remove matchedFromMany behavior that
   assumes broad matches authorize playback. Update the domain rule in the same package.

Tests: reordered title/author tokens; case/accents/punctuation; empty input; literal SQL wildcard input;
>10 author matches/counts; duplicate titles; four or more results retained; deterministic pagination;
wrong user, missing/old contract, downloaded-session filtering. Exercise actual Swift/SQLite behavior,
not just a TypeScript reimplementation. Reuse a native test target or a small runnable Swift harness;
record its exact command. Inspect the existing Swift harness pattern under scripts/ before adding infrastructure.

Done: all wrappers consume one tested search policy; no arbitrary broad-match autoplay; counts and
pagination agree; coordinator reviews query/access correctness and test evidence.

## P2 — Property queries and typed discovery

Dependencies: P1. Own: generic/Books/Audio entity query adapters, minimal new query adapter helper.

Work:

1. Expose supported author, title, narrator, series, downloaded, and finished comparisons where each
   entity actually has those properties. Support AND/OR, stable sorting, and framework-provided limits.
2. Map comparator values to typed criteria; forward to P1. Do not build SQL inside individual entities.
3. Define author equality truthfully: individual-author membership when metadata exists; otherwise
   exact combined-credit equality and explicitly named contains matching. Never present substring
   matching as exact person identity.
4. Confirm generated Find actions return usable Assistant Books. Add typed collection output to
   custom search actions when supported, using bounded output and honest total-count dialog.

Tests: combined author/downloaded filters, AND versus OR, sort/limit, coauthor behavior, access scope.
Done: metadata and a Shortcuts action demonstrate working property filters; coordinator distinguishes
this evidence from untested natural-language Siri interpretation.

## P3 — Author resolution and useful Assistant Replies

Dependencies: P1; coordinate entity files with P2. Own: author entity/query (new), author/general search
intents, AssistantShortcuts.swift, AssistantSnippetViews.swift, Siri settings examples.

Work:

1. Add a session-scoped author AppEntity with stable IDs and string lookup/suggestions. Use reliable
   individual author metadata when available; do not split display names blindly on commas or “and”.
   If the projection needs author members, extend the versioned contract and TS writer transactionally,
   including retained-download fallback, rebuild, clear, and old-contract behavior. Record the limitation
   where retained metadata contains only a combined credit. Do not fetch the server during native lookup.
2. Add author-parameter phrases for “Books by [author]…” and “What books do I have by [author]…”.
   Keep a prompt-based path and a bounded suggestions policy; test an author outside suggestions.
3. Preserve existing saved shortcuts. Before changing an existing String parameter to an entity,
   prove compatibility or add a new entity-backed action and retain the legacy String action.
   Keep one AppShortcutsProvider and within platform phrase/action limits.
4. General search uses “Search”, not “Title”. Native replies give the total, speak at most five titles,
   and display at most ten; say when more results exist. Zero and one matches have natural wording.
5. Offer explicit open/play/show-results controls using APIs supported by the deployment target.
   Gate richer interactive snippets where necessary; provide an older-system fallback. Search never
   plays a book as a side effect. Wire show-results after P4, not to a placeholder destination.

Tests: zero/one/many matches, true count >10, stale author from old session, missing/coauthor metadata,
legacy shortcut still runs, result action identities, voice-only reply. Native build/metadata extraction required.
Done: author arrives from a one-utterance request on the recorded test configuration, or the precise
platform limitation remains documented as unverified/failed. Functional code alone is not Siri acceptance.

## P4 — In-app search with preserved scope and cold launch

Dependencies: P1, product decisions, P0 route design. Own: new search/open-results intents, small native
read bridge if needed, assistant results route/controller, startup navigation integration.

Work:

1. Implement ShowInAppSearchResultsIntent with StringSearchCriteria and the appropriate system schema
   for the supported SDK/OS. Verify search versus searchInApp naming/availability instead of copying
   deprecated examples. Keep a conventional fallback for older systems.
2. For all-library scope, prefer a dedicated Assistant Catalog results route reusing existing book
   presentation components. Expose bounded native reads using P1 so app results match Siri without
   broadening the ordinary active-Library Search tab. Coordinator may choose another equally small
   design in P0, but it must preserve scope and downloaded-session access.
3. Carry query/author filter and trusted session binding through navigation. Revalidate session before
   display and on pagination; clear stale results on logout/switch. Validate URL input if using deep links.
4. Integrate with existing startup/deep-link readiness. Preserve launch destination, deliver the search
   once, and prevent Home redirects from discarding it. Navigation must not take playback ownership.
   Reuse suitable infrastructure; keep search navigation distinct from the expiring playback queue.
5. Display the current query, scope label, empty/error/loading states, and all results through bounded
   loading. Existing active-Library filters must not silently hide assistant matches. Route book open/play
   through existing identity/access rules, including books outside the active Library and retained downloads.
6. Connect P3 show-results affordance. System in-app search opens the app by design; keep native
   question-answer actions available separately.

Tests: warm/cold launch, startup redirect, repeated delivery, session switch mid-launch, expired/stale
navigation where applicable, signed-out access, downloaded-session browsing, multi-Library results,
query escaping, stable pagination, zero playback side effects. Include a React Native route test or
focused controller tests plus one UI smoke test; do not treat a store setter test as launch coverage.

Done: the exact query and scope survive cold launch; full results agree with P1 counts; old app-search
flows and playback startup still work. Physical Siri routing is recorded separately.

## P5 — Schema-aware indexing and modern audio routing

Dependencies: P1; coordinate wrappers with P2 and playback changes. Own: AssistantSpotlightIndexer.swift,
Books/Audio schema adapters, lifecycle integration and narrowly scoped metadata changes.

Work:

1. Verify schema entities are discoverable and playable through extracted metadata and runtime traces.
   Adapt indexing to the appropriate schema-aware entity for the OS while retaining existing generic
   saved-shortcut identifiers. Avoid duplicate Spotlight entries for one Assistant Book.
2. Migrate index contents explicitly: remove obsolete entity types during upgrade/reindex, and clear
   every used type on logout. Keep the same user/item identity semantics across wrappers.
3. Validate AudioSearch cases: text -> complete bounded matches; unspecified -> deliberate resume;
   URL -> supported LAABS book only. Audit URL parsing for host/path ambiguity and stale identities.
4. Verify the AudioSearch IntentValueQuery is discovered. Follow current Apple examples if a change
   is needed; do not assume lack of direct Swift references means it is unused.
5. Keep schema playback on existing access/dispatcher services. Verify duplicate-edition disambiguation,
   cancellation, cold playback, downloaded-only behavior, and old Books-schema compatibility.
6. Measure indexing/search on a representative catalog and document the current index-size ceiling;
   do not silently claim uncapped discovery (the existing all() default is 5,000).

Done: a recorded supported Siri configuration discovers a non-suggested book and routes playback to
its correct identity; stale/duplicate index cleanup verified. Unavailable device cases stay NOT RUN.

## P6 — Integration acceptance and documentation

Dependencies: P2–P5. Owner: coordinator verifies; implementer fixes scoped findings.

Run focused suites affected by changes, typecheck, touched-file lint, one integrated native build with
App Intents metadata extraction, and the phrase matrix in the verification record. Re-run repository
lint once at final integration and compare with baseline; unrelated failures are not scope expansion.
Update the handoff, settings examples, catalog docs if its contract changed, and domain/ADR changes
actually made. Distinguish implemented, code-verified, and Siri-device-verified capabilities.

Acceptance includes:

- Author request captures the author; full count and bounded reply are correct.
- Title and author text search work; app result handoff preserves scope.
- Unique named book plays; duplicate/broad matches ask instead of guessing.
- A non-suggested author/book is tested separately from suggested items.
- Logout/session switching never returns previous-user results, including Spotlight and stale actions.
- Offline/downloaded-session behavior follows existing access policy.
- Legacy saved shortcuts, Resume, Pause, Bookmark Here, and sleep timer have no regressions.

## Scheduling and verification rules

Default sequence: P0 -> P1 -> P3 (author milestone) -> P2 -> P4 -> P5 -> P6.
If parallel execution is explicitly requested, P3 and P4 may run after P1 with separate ownership.
P2 and P5 both modify wrappers: serialize them or have one integrator own those files.

Coordinator review gates:

- After P0: approve concrete interfaces and test setup; resolve product assumptions.
- After P1: inspect actual native query tests, access scope, limits, and ambiguity policy.
- After each later package: read diff, inspect tests, independently run the most relevant checks,
  record findings and disposition. A failing native build blocks acceptance of Swift packages.
- Final: independently verify integrated code and review recorded device evidence. User-run device
  results are labeled as such; simulator/build success never substitutes for Siri evidence.

Escalate to the coordinator after one documented API/architecture uncertainty investigation, rather
than spending repeated model turns guessing signatures. Use the installed SDK and primary Apple docs.
Do not copy the entire repository/history into each agent prompt or rerun all suites after every edit.
No new service, LLM parser, package upgrade, or playback redesign is needed for this scope.

### Reusable implementation assignment

> Implement package P<N> from docs/assistant-search-implementation-plan.md. Read Start here,
> Product contract, Architecture constraints, and P<N>; consult other references only as needed.
> Inspect current status and preserve unrelated changes. Own only <files>; coordinate any expansion.
> Follow the package completion criteria. Update your row/evidence in
> docs/assistant-search-verification.md. Return changed files, commands/results, unresolved risks,
> and review entry points in at most 400 words. Do not start the next package or commit unless asked.

### Reusable coordinator verification assignment

> Verify P<N> against its acceptance criteria and the actual diff. Review identity/access, query
> semantics, compatibility, and cross-layer behavior relevant to this package. Run focused independent
> checks. Report actionable findings with file/line evidence; record PASS, FAIL, or NOT RUN separately
> for code/build/device checks. Return the smallest follow-up assignment needed. Do not equate
> missing device access with either passing Siri acceptance or failed source implementation.

## Primary references

Consult these when implementing the corresponding API; recheck availability in the installed SDK.

- [EntityPropertyQuery](https://developer.apple.com/documentation/AppIntents/EntityPropertyQuery): P2 comparator contract.
- [App Shortcuts parameter restrictions](https://developer.apple.com/videos/play/wwdc2023/10102/): P3 phrases and suggestions.
- [ShowInAppSearchResultsIntent](https://developer.apple.com/documentation/appintents/showinappsearchresultsintent): P4 criteria and foreground results.
- [Audio search and playback](https://developer.apple.com/documentation/MediaIntents/responding-to-audio-search-and-playback-requests): P5 AudioSearch queries.
- [Advanced App Intents, WWDC26](https://developer.apple.com/videos/play/wwdc2026/343/): schema search, indexing, and optional future onscreen awareness.

## Deferred

App-name-free guarantees, arbitrary conversational follow-ups/onscreen awareness, podcast discovery,
new genre metadata, live server search, custom language models, and Control Center extensions.
Revisit after the three core phrases have recorded acceptance evidence.
