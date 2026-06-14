# Plan 006: Add characterization tests for the pure download helpers in device-books-store

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 48350c6..HEAD -- src/store/device-books-store.ts`
> If it changed, compare the "Current state" excerpts against the live code (the
> helper functions and their line numbers) before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (additive; does not change runtime code paths)
- **Category**: tests
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

`src/store/device-books-store.ts` is 4017 lines and has **zero tests**, yet it
owns the Downloaded Audio Asset lifecycle (a core, ADR-documented concern —
ADRs 0006, 0008, 0019). The riskiest *pure* logic in it — download-progress
aggregation and path normalization — is currently untested, and plan 007 wants
to move it into its own module. Characterization tests written **first** lock in
today's behavior so the 007 extraction is provably behavior-preserving. They are
also the highest-value first tests for this module: pure functions, no native or
async dependencies, fast to write.

This plan only **exports** the existing pure helpers (no logic change) and tests
them. It does not move them — that is plan 007.

## Current state

The following are module-private (`const`, not exported) pure helpers near the
top of `src/store/device-books-store.ts`. They depend only on four imports from
`./fileSystemAccess` (`BOOK_DOWNLOADS_DIRECTORY`, `isRelativeDocumentPath`,
`resolveDocumentRelativePath`, `toDocumentRelativePath`) plus types — **no
zustand, no network, no native modules**.

- `extractFileNameFromUri(uri: string): string` — `device-books-store.ts:73-78`.
  Strips query/hash, trailing slash, returns last path segment.
- `buildDownloadDirectoryRelativePath(libraryItemId: string): string` —
  `:80-81`. Returns `${BOOK_DOWNLOADS_DIRECTORY}/${libraryItemId}`.
- `toLegacyDownloadRelativePath(libraryItemId, storedPath?, fallbackFileName?)` —
  `:83-106`. Migrates legacy absolute/uri paths to relative download paths;
  returns `null` when no filename can be derived.
- `normalizeDownloadTrackRecord(libraryItemId, track: unknown): DownloadTrack | null`
  — `:108-137`. Validates/normalizes a track record; returns `null` if no
  relative path resolves.
- `normalizeDownloadInfo(libraryItemId, info?): DownloadInfo | null` — `:139-165`.
  Normalizes audio tracks + cover path.
- `normalizePersistedDownloadedBookData(downloadedBookData?)` — `:167-179`. Maps
  over a record, dropping entries that don't normalize.
- `clampDownloadPercent(value: number): number` — `:216`. `Math.max(0,
  Math.min(100, Math.round(value)))`.
- `isKnownDownloadByteSize(value): value is number` — `:218-219`. `> 0` &&
  finite.
- `buildAggregateDownloadProgress({ libraryItemId, stage, fileProgress,
  fallbackFileIndex, totalAudioBytes, useByteWeightedProgress }): DownloadProgress`
  — `:230-296`. The meatiest one: aggregates per-file progress into one
  `DownloadProgress`, handling byte-weighted vs file-count progress, the
  multi-active-file label, and the `finalizing` cap at 99%.

Excerpt of the highest-value target (`buildAggregateDownloadProgress`, abbreviated):
```ts
const buildAggregateDownloadProgress = ({ libraryItemId, stage, fileProgress,
  fallbackFileIndex, totalAudioBytes, useByteWeightedProgress }): DownloadProgress => {
  const totalFiles = fileProgress.length;
  const activeFiles = fileProgress.filter((file) => file.active && !file.completed);
  // ... receivedBytes reduce, rawPercent (byte-weighted vs file-units) ...
  const progress = clampDownloadPercent(stage === "finalizing" ? Math.min(rawPercent, 99) : rawPercent);
  return { libraryItemId, stage, progress, /* received,total,currentFileName,... */ };
};
```

Existing test to model after: `src/auth/__tests__/enter-user-session.test.ts`
(uses `jest.mock(...)` for dependencies, `describe`/`it`, plain assertions). The
jest config in `package.json` runs `**/__tests__/**/*.test.ts` under `src` via
`jest-expo`.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Test one  | `npm test -- device-books`                               | new suite passes    |
| Test all  | `npm test`                                               | all suites pass     |
| Typecheck | `npm run typecheck` (or `npx tsc --noEmit -p tsconfig.json`) | exit 0          |

## Scope

**In scope**:
- `src/store/device-books-store.ts` — **only** add the `export` keyword to the
  pure helpers listed above (and the three private types they need:
  `DownloadFileProgressSnapshot`, and `DownloadTrack`/`DownloadInfo`/`DownloadProgress`/
  `DownloadStage` are already exported — verify). No logic changes.
- `src/store/__tests__/device-books-download-helpers.test.ts` (create)

**Out of scope**:
- Any of the **stateful** store actions (the 180+ methods, the zustand
  `createStore`, persistence, download orchestration). Do not test or touch them.
- Moving the helpers to a new file — that is plan 007. Here they stay in place,
  just exported.
- Changing helper logic to "fix" anything you find surprising. These are
  **characterization** tests: assert what the code does **today**, even if a
  branch looks odd. If you believe a helper has a bug, write the test to match
  current behavior and note the suspected bug in your report — do not change the
  code.

## Git workflow

- Branch: `advisor/006-characterize-download-helpers`
- Message e.g. `Add characterization tests for device-books download helpers`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Export the pure helpers (no logic change)

In `src/store/device-books-store.ts`, add `export` to each helper listed in
"Current state". Example: change `const extractFileNameFromUri = ...` to
`export const extractFileNameFromUri = ...`. Do the same for the other eight.
Also export the local type `DownloadFileProgressSnapshot` (`:221-228`) so tests
can construct inputs for `buildAggregateDownloadProgress`.

**Verify**: `npm run typecheck` → exit 0. `npm test` → still passes (exports
don't change runtime). Confirm no other code broke:
`grep -rn "extractFileNameFromUri\|buildAggregateDownloadProgress" src` — these
should only appear in `device-books-store.ts` (internal callers), confirming the
exports are purely additive.

### Step 2: Write the characterization suite

Create `src/store/__tests__/device-books-download-helpers.test.ts`. Mock
`./fileSystemAccess` so the helpers' dependencies are deterministic — model the
mock on how `enter-user-session.test.ts` mocks its deps. A reasonable mock:
```ts
jest.mock("../fileSystemAccess", () => ({
  BOOK_DOWNLOADS_DIRECTORY: "book-downloads",
  isRelativeDocumentPath: (p: string) => typeof p === "string" && !p.startsWith("file:") && !p.startsWith("/"),
  resolveDocumentRelativePath: (p: string | null) => (p ? `file:///docs/${p}` : null),
  toDocumentRelativePath: (p: string) => (p?.startsWith("file:///docs/") ? p.replace("file:///docs/", "") : null),
}));
```
**Important**: before finalizing the mock, open `src/store/fileSystemAccess.ts`
and read the **real** implementations of those four functions, then make your
mock behave the same way for the inputs you test. If the real behavior differs
from the sketch above, match the real behavior (characterization).

Cover, at minimum:
- `extractFileNameFromUri`: plain path, path with `?query`, path with `#hash`,
  trailing slash, no slash, empty string.
- `clampDownloadPercent`: negative → 0, >100 → 100, fractional → rounded,
  in-range passthrough.
- `isKnownDownloadByteSize`: `0` → false, negative → false, `NaN`/`Infinity` →
  false, positive finite → true, `null`/`undefined` → false.
- `toLegacyDownloadRelativePath`: already-relative under the downloads dir
  passthrough, a legacy `file://` uri, a value with no derivable filename → null.
- `normalizeDownloadTrackRecord`: a valid track, a non-object input → null, a
  track whose path cannot resolve → null, defaulting of missing numeric fields.
- `normalizeDownloadInfo` / `normalizePersistedDownloadedBookData`: an info with
  mixed valid/invalid tracks, an entry that fully fails to normalize is dropped.
- `buildAggregateDownloadProgress` (the priority target): single active file
  byte-weighted progress; multiple active files → `"N files downloading"` label
  and summed `currentFileSize`; `stage === "finalizing"` caps `progress` at 99;
  empty `fileProgress` → `progress 0`, `numberOfFiles 0`; file-units path
  (`useByteWeightedProgress: false`).

**Verify**: `npm test -- device-books` → the new suite passes with all cases.

### Step 3: Run the full gate

**Verify**: `npm test` → all suites pass (the original auth suite + the new one).
`npm run typecheck` → exit 0.

## Test plan

(Defined above in Step 2.) The suite is the deliverable. Target: every pure
helper has at least its happy path plus its documented edge cases (null/empty,
clamping bounds, the finalizing cap, multi-file label). These tests become the
safety net for plan 007's extraction.

## Done criteria

- [ ] The nine helpers + `DownloadFileProgressSnapshot` are `export`ed from
      `device-books-store.ts` with **no logic change** (diff shows only added
      `export` keywords)
- [ ] `src/store/__tests__/device-books-download-helpers.test.ts` exists and
      `npm test` passes including its cases
- [ ] `npm run typecheck` exits 0
- [ ] No other `src/` files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The helper line numbers / signatures in "Current state" don't match the live
  file (drift) — re-locate before testing.
- A helper turns out to depend on module-level mutable state or a non-pure import
  you cannot mock deterministically — report it; it may not be a safe extraction
  target for 007.
- You find a genuine bug while characterizing — write the test to current
  behavior, flag the bug in your report, do **not** fix it here.

## Maintenance notes

- These tests are the precondition for plan 007 (extracting the helpers into
  `device-books-download-helpers.ts`). After 007 moves the functions, this test
  file's imports must be re-pointed at the new module — 007 owns that update.
- A reviewer should confirm Step 1's diff is purely additive `export` keywords
  (no behavior change) and that the mock of `fileSystemAccess` matches the real
  module's behavior for the tested inputs.
