# LAABS Audio Documentation Index

Routing guide for the `docs/` folder. Domain vocabulary lives in
[../CONTEXT.md](../CONTEXT.md) — use its terms when reading or writing any doc here.

## Start here

| Doc | Read it when you need… |
| --- | --- |
| [repo-onboarding.md](./repo-onboarding.md) | the codebase tour: folders, conventions, working rules for agents |
| [marketing-feature-overview.md](./marketing-feature-overview.md) | a user-facing description of what the app does |

## Data & state architecture

| Doc | Read it when you need… |
| --- | --- |
| [data-state-architecture.md](./data-state-architecture.md) | where data lives (SQLite read model vs React Query/MMKV vs Zustand) and what triggers fetches |
| [shadow-sqlite-architecture.md](./shadow-sqlite-architecture.md) | the SQLite module map (`src/data/sqlite/`), conventions, and read paths |
| [shadow-sqlite-tables.md](./shadow-sqlite-tables.md) | the SQLite schema: tables, columns, views, indexes |
| [ReactQueryPersister.md](./ReactQueryPersister.md) | which queries persist to MMKV and the `meta.persist` invariants |
| [abs-data-hooks.md](./abs-data-hooks.md) | the shared hooks in `src/hooks/abs-data-hooks.ts` (user state, item details, series) |
| [absAPIAccess.md](./absAPIAccess.md) | the Audiobookshelf API module map (`src/api/`) |
| [startup-task-map.md](./startup-task-map.md) | what runs at app startup and which tasks can block first render |

## Auth, sessions & libraries

| Doc | Read it when you need… |
| --- | --- |
| [absAuthFlow.md](./absAuthFlow.md) | the auth flow: multiple sign-ins, User Session Entry & switching, storage, token handling |
| [auth-library-flow-technical.md](./auth-library-flow-technical.md) | Library Resolution / Selection / Activation implementation details |
| [auth-library-flow-user.md](./auth-library-flow-user.md) | the same flows described from the user's perspective |
| [future-auth-flow-enhancements.md](./future-auth-flow-enhancements.md) | deferred auth/session ideas |

## Playback & progress

| Doc | Read it when you need… |
| --- | --- |
| [audioPlayerFlow.md](./audioPlayerFlow.md) | the player service, AudioPro integration, and playback lifecycle |
| [listening-position-sync.md](./listening-position-sync.md) | how the Displayed Listening Position resolves and syncs |
| [progress-cache-lifecycle.md](./progress-cache-lifecycle.md) | end-to-end progress data flow: caches, reconcile, write-through |
| [progress-sync-queue.md](./progress-sync-queue.md) | the offline progress sync intent queue |
| [sleep-timer.md](./sleep-timer.md) | sleep timer architecture |

## Home, shelves & browsing

| Doc | Read it when you need… |
| --- | --- |
| [bookshelves-concept-flow-code.md](./bookshelves-concept-flow-code.md) | Home Shelf Display: derived/custom/playlist shelves, Discover, settings |
| [home-book-card-menu.md](./home-book-card-menu.md) | the Home card context menu |

## Features & UX

| Doc | Read it when you need… |
| --- | --- |
| [download-ux.md](./download-ux.md) | the Downloaded Audio Asset UX |
| [offline-handling.md](./offline-handling.md) | offline detection, the connection banner, and retry behavior |
| [DEEP_LINKING.md](./DEEP_LINKING.md) | shared-book deep links and cold-start handling |
| [form-sheet-layout.md](./form-sheet-layout.md) | form-sheet layout conventions |
| [future-enhancements.md](./future-enhancements.md) | general deferred ideas |

## Theming

| Doc | Read it when you need… |
| --- | --- |
| [theming-style-guide.md](./theming-style-guide.md) | theme tokens and how to style components |
| [theming-implementation-plan.md](./theming-implementation-plan.md) | the original token plan and Uniwind references |

## Decisions (ADRs)

Architecture Decision Records in [adr/](./adr/). Don't re-litigate these; if one blocks you,
propose superseding it.

| ADR | Decision |
| --- | --- |
| [0001](./adr/0001-local-bookmark-records.md) | Local Bookmark Records own bookmark state |
| [0002](./adr/0002-clip-export-from-downloaded-media.md) | Clip exports start from downloaded media |
| [0003](./adr/0003-ios-first-clip-transcription.md) | iOS-first clip transcription uses Apple Speech |
| [0004](./adr/0004-library-resolution-before-browsing.md) | Library Resolution happens before browsing |
| [0005](./adr/0005-durable-progress-sync-intents-before-remote-sync.md) | Durable progress sync intents before remote sync |
| [0006](./adr/0006-identity-scoped-downloaded-progress-survives-logout.md) | Identity-scoped downloaded progress survives logout |
| [0007](./adr/0007-provisional-streamed-playback-start-attempts.md) | Provisional streamed playback start attempts |
| [0008](./adr/0008-separate-session-state-from-download-access-mode.md) | Separate session state from download access mode |
| [0009](./adr/0009-library-activation-before-active-library-commit.md) | Library Activation before Active Library commit |
| [0010](./adr/0010-explicit-logout-clears-session-snapshots.md) | Explicit logout clears session snapshots |
| [0011](./adr/0011-explicit-logout-requires-sign-in-before-playback.md) | Explicit logout requires sign-in before playback |
| [0012](./adr/0012-playback-control-intents-settle-on-audible-state.md) | Playback control intents settle on audible state |
| [0013](./adr/0013-observable-resume-resolution-for-displayed-listening-position.md) | Observable resume resolution for Displayed Listening Position |
| [0014](./adr/0014-remembered-user-sessions-for-sign-in-switching.md) | Remembered User Sessions for sign-in switching |
| [0015](./adr/0015-audiobookshelf-user-identity-owns-local-listening-state.md) | Audiobookshelf User Identity owns local listening state |
| [0016](./adr/0016-cache-first-search-result-sets.md) | Cache-first Search Result Sets |
| [0017](./adr/0017-local-sqlite-read-model-for-large-audiobookshelf-libraries.md) | Local SQLite read model for large libraries (phased cutover) |
| [0018](./adr/0018-accumulated-skip-bursts.md) | Accumulated skip bursts |
| [0019](./adr/0019-shadow-sqlite-concern-modules.md) | Shadow SQLite concern modules with ids-first search reads |
| [0020](./adr/0020-single-user-session-entry-module.md) | Single User Session Entry module crosses the boundary after identity is confirmed |
| [0023](./adr/0023-sqlite-read-model-for-collections.md) | Server-owned Collections use a normalized SQLite read model |

Note: ADRs are point-in-time records. ADR-0017's phased-cutover details are completed and
superseded in part by ADR-0019; read 0017 for the why, 0019 plus
[shadow-sqlite-architecture.md](./shadow-sqlite-architecture.md) for the current shape.

## Native modules & patches

| Doc | Read it when you need… |
| --- | --- |
| [react-native-audio-pro-changes.md](./react-native-audio-pro-changes.md) | the catalog of local changes to the vendored `react-native-audio-pro` module |
| [react-native-screens-patches.md](./react-native-screens-patches.md) | what's in the `react-native-screens` patch (iOS 26 mini-player fixes) |
| [eas-patch-package-cng-builds.md](./eas-patch-package-cng-builds.md) | how `patch-package` native edits survive EAS/CNG builds |

## Agents & tooling

| Doc | Read it when you need… |
| --- | --- |
| [agents/domain.md](./agents/domain.md) | domain guidance for coding agents |
| [agents/issue-tracker.md](./agents/issue-tracker.md) | issue tracker conventions |
| [agents/triage-labels.md](./agents/triage-labels.md) | triage label definitions |
| [argent-screenshot-brief.md](./argent-screenshot-brief.md) | simulator screenshot conventions for QA tooling |
