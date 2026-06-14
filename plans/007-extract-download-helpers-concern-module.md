# Plan 007: Extract the pure download helpers into a `device-books-download-helpers` concern module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 48350c6..HEAD -- src/store/device-books-store.ts`
> If it changed since this plan was written, re-confirm the helper set and their
> imports before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M (was rated L for "split the god object" — this plan deliberately
  scopes it down to the *pure* concern only; see "Scope")
- **Risk**: MED
- **Depends on**: 006 (characterization tests must exist and pass first — they
  prove this move is behavior-preserving)
- **Category**: tech-debt / architecture
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

`src/store/device-books-store.ts` is 4017 lines — by far the largest file in the
repo and one of the highest-churn. ADR 0019 ("Split shadow SQLite service into
concern modules with one auth seam") and ADR 0020 ("single User Session Entry
module") establish the repo's pattern: peel cohesive concerns out of giant
modules into focused, testable files. This plan applies that exact pattern to the
**pure** download-helper concern — the functions plan 006 just covered with
tests — moving them into `device-books-download-helpers.ts`. It shrinks the god
object, gives the helpers a named home, and the tests from 006 guarantee no
behavior change.

This is intentionally a **small, safe first cut**, not a full decomposition of
the store. Splitting the stateful actions (downloads orchestration, progress
sync, playlist management) is explicitly deferred — those carry far higher risk
and need their own characterization tests first.

## Current state

- `src/store/device-books-store.ts` — after plan 006, these pure helpers are
  `export`ed and tested: `extractFileNameFromUri`,
  `buildDownloadDirectoryRelativePath`, `toLegacyDownloadRelativePath`,
  `normalizeDownloadTrackRecord`, `normalizeDownloadInfo`,
  `normalizePersistedDownloadedBookData`, `clampDownloadPercent`,
  `isKnownDownloadByteSize`, `buildAggregateDownloadProgress`, plus the type
  `DownloadFileProgressSnapshot`.
- Their only non-type dependencies are four imports from `./fileSystemAccess`
  (`device-books-store.ts:26-34`):
  ```ts
  import {
    BOOK_DOWNLOADS_DIRECTORY,
    deleteFromFileSystem,
    downloadFileBlob,
    ensureAppDirectory,
    isRelativeDocumentPath,
    resolveDocumentRelativePath,
    toDocumentRelativePath,
  } from "./fileSystemAccess";
  ```
  Of these, the helpers use only: `BOOK_DOWNLOADS_DIRECTORY`,
  `isRelativeDocumentPath`, `resolveDocumentRelativePath`, `toDocumentRelativePath`.
- The types they reference (`DownloadTrack`, `DownloadInfo`, `DownloadProgress`,
  `DownloadStage`) are already exported from `device-books-store.ts`
  (`:57,66,193,195`). Constants used: `DOWNLOAD_COVER_FILE_NAME` (`:71`).
- Tests live at `src/store/__tests__/device-books-download-helpers.test.ts`
  (created in 006), currently importing the helpers from `../device-books-store`.
- The store's own action code calls these helpers internally (e.g.
  `normalizeDownloadInfo`, `buildAggregateDownloadProgress`,
  `resolveDownloadTrackUri`). Those internal call sites must keep working after
  the move.

ADR pattern to match — read `docs/adr/0019-shadow-sqlite-concern-modules.md` and
look at the existing concern split under `src/data/sqlite/` for the naming and
file-layout convention (one concern per file, plain exported functions, the
parent module re-imports them). Mirror that style.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                                      | exit 0              |
| Test one  | `npm test -- device-books`                               | suite passes        |
| Test all  | `npm test`                                               | all pass            |
| Lint      | `npx expo lint`                                          | no new violations   |
| Grep      | `grep -rn "<symbol>" src`                                | as noted per step   |

## Scope

**In scope**:
- `src/store/device-books-download-helpers.ts` (create — the moved helpers)
- `src/store/device-books-store.ts` (remove the moved definitions; import them
  back from the new module so internal callers are unchanged)
- `src/store/__tests__/device-books-download-helpers.test.ts` (re-point imports
  to the new module)

**Out of scope** (do NOT touch):
- Any stateful store action, the zustand `createStore`/`persist` setup, download
  orchestration, progress sync, playlist logic. Move **only** the pure functions
  listed in "Current state".
- The non-pure file helpers `resolveDownloadTrackUri`, `resolveDownloadCoverUri`,
  `hasValidRelativeDownloadTrack`, `hasPlayableDownloadAudio`
  (`device-books-store.ts:181-191`) — these are thin and tied to runtime path
  resolution. Leave them in the store for this cut (they can move in a follow-up).
  If moving a pure helper would force one of these to move too, STOP and report.
- Changing any helper's logic. This is a pure move + re-import. The 006 tests
  must pass **unchanged in behavior** (only their import path changes).

## Git workflow

- Branch: `advisor/007-extract-download-helpers`
- Commit e.g. `Extract pure download helpers into device-books-download-helpers (ADR-0019 pattern)`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the new concern module

Create `src/store/device-books-download-helpers.ts`. Move the nine pure helpers
and the `DownloadFileProgressSnapshot` type into it. The module imports:
- from `./fileSystemAccess`: `BOOK_DOWNLOADS_DIRECTORY`, `isRelativeDocumentPath`,
  `resolveDocumentRelativePath`, `toDocumentRelativePath`
- from `./device-books-store` (type-only): `DownloadTrack`, `DownloadInfo`,
  `DownloadProgress`, `DownloadStage` — use `import type` to avoid a runtime
  cycle. **If this creates a circular import** (the store will import values back
  from this module in Step 2, and this module imports types from the store):
  type-only imports are erased at compile time and do not cause a runtime cycle,
  so this is safe. But if `tsc` or Metro complains, move the four download types
  themselves into the new helpers module and have the store re-export them
  (`export type { DownloadTrack } from "./device-books-download-helpers"`). Decide
  based on what `tsc` reports; record which you chose.
- Move `DOWNLOAD_COVER_FILE_NAME` constant too (only the helpers use it — verify
  with `grep -n "DOWNLOAD_COVER_FILE_NAME" src/store/device-books-store.ts`; if
  other code uses it, keep it in the store and import it instead).

Export every moved helper.

**Verify**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep device-books` — expect
errors in `device-books-store.ts` (duplicate/now-missing definitions) until Step
2; that's fine. The new file itself should have no errors:
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep device-books-download-helpers` →
no output.

### Step 2: Re-import the helpers into the store

In `src/store/device-books-store.ts`, delete the now-moved definitions and add an
import from the new module:
```ts
import {
  extractFileNameFromUri,
  buildDownloadDirectoryRelativePath,
  toLegacyDownloadRelativePath,
  normalizeDownloadTrackRecord,
  normalizeDownloadInfo,
  normalizePersistedDownloadedBookData,
  clampDownloadPercent,
  isKnownDownloadByteSize,
  buildAggregateDownloadProgress,
} from "./device-books-download-helpers";
```
All internal call sites in the store keep working unchanged because the names are
identical. If any moved helper was also `export`ed from the store and is imported
elsewhere, re-export it for compatibility:
`export { normalizeDownloadInfo } from "./device-books-download-helpers";` — but
first check: `grep -rn "from \"../store/device-books-store\"" src` and
`grep -rn "device-books-store" src` to find external importers of these specific
symbols. If none import the helpers (likely — they were only internal), no
re-export is needed.

**Verify**: `npm run typecheck` → exit 0. `grep -n "const extractFileNameFromUri\|const buildAggregateDownloadProgress" src/store/device-books-store.ts`
→ no output (definitions removed, not duplicated).

### Step 3: Re-point the test imports

In `src/store/__tests__/device-books-download-helpers.test.ts`, change the import
of the helpers from `../device-books-store` to
`../device-books-download-helpers`. The `jest.mock("../fileSystemAccess", ...)`
stays (the new module imports from the same `./fileSystemAccess`). Do **not**
change any assertion — the tests must pass identically.

**Verify**: `npm test -- device-books` → all cases pass, unchanged.

### Step 4: Full gate

**Verify**:
- `npm run typecheck` → exit 0
- `npm test` → all suites pass
- `npx expo lint` → no new violations introduced
- `wc -l src/store/device-books-store.ts` → smaller than before (roughly −120
  lines)

## Test plan

No new tests. The 006 characterization suite is the proof of correctness; it must
pass after only its import path changes. If any 006 test fails after the move,
the move changed behavior — that is a STOP condition (the move must be a pure
relocation).

## Done criteria

- [ ] `src/store/device-books-download-helpers.ts` exists, exporting the nine
      pure helpers (+ the snapshot type)
- [ ] `device-books-store.ts` no longer defines them and imports them back; the
      file is ~120 lines shorter
- [ ] `src/store/__tests__/device-books-download-helpers.test.ts` imports from the
      new module and `npm test` passes with identical assertions
- [ ] `npm run typecheck` exits 0; `npx expo lint` introduces no new violations
- [ ] No out-of-scope files modified; no stateful store logic touched (`git diff`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Moving a pure helper forces moving a stateful/non-pure function or a store
  action to satisfy imports — the cut is not as clean as assumed; report the
  coupling.
- A 006 test fails after the move (behavior changed — a pure relocation should
  not change behavior).
- A circular-import error appears that type-only imports + the
  re-export-the-types fallback (Step 1) do not resolve.
- An external module imports one of these helpers from `device-books-store` in a
  way the re-export does not cover.

## Maintenance notes

- This is the first concern peeled off `device-books-store.ts`. The natural
  follow-ups (separate plans, each needing its own characterization tests first):
  the **download orchestration** actions, the **progress-sync** actions, and the
  **playlist-shelf** actions — each a cohesive seam per the ADR-0019 pattern. Do
  not attempt them without tests; they are stateful and high-risk.
- A reviewer should diff the new module against the old definitions line-by-line
  to confirm it is a pure move (no logic edits), and confirm `git diff` on the
  store shows only deletions + the new import (no action-method changes).
- The `meta`/commit-changelog convention in `AGENTS.md` asks that commits update
  `NEW_FEATURES.md`; this is an internal refactor with no tester-facing behavior —
  note in the commit that there is no user-facing change, or add a one-line
  "internal: no behavior change" entry if the repo expects every commit listed.
