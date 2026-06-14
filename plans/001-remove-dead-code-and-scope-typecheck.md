# Plan 001: Delete dead code and stop type-checking the starter scaffold

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 48350c6..HEAD -- src/OLD_apiClass.ts src/api/track-builder.ts tsconfig.json tsconfig.test.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

`npx tsc --noEmit` currently emits dozens of errors, but most are noise: a
990-line legacy file (`src/OLD_apiClass.ts`) importing packages that are no
longer installed, an orphaned `src/api/track-builder.ts` importing an
uninstalled package, and a leftover `example/` create-expo-app scaffold whose
imports never resolved. This noise hides ~9 *real* type errors in `src/` and is
the reason no one can use `tsc` as a pass/fail gate. Removing the dead code and
scoping the typechecker is the precondition for every later plan (the real-error
fix in 003 and the verification gate in 004).

## Current state

- `src/OLD_apiClass.ts` — 990-line legacy API class. Imports `axios`,
  `@store/mmkv/mmkv`, `./abstypes` — none of which resolve. **No file in `src/`
  imports it** (verified: `grep -rln "OLD_apiClass" src` returns only the file
  itself). Superseded by the modular `src/api/` layer.
- `src/api/track-builder.ts` — imports `PitchAlgorithm` from
  `react-native-track-player`, which is **not** in `package.json` dependencies.
  **No file imports it or `buildTrackPlayerTracks`** (verified: `grep -rln
  "track-builder\|buildTrackPlayerTracks" src` returns only the file itself).
  This app uses the vendored `react-native-audio-pro` module for playback, not
  `react-native-track-player`.
- `example/` — a create-expo-app starter scaffold at the repo root. Its files
  import `@/components/themed-text`, `@/constants/theme`, etc., which exist only
  inside the scaffold's own imagined structure and resolve against the real
  `src/` via the `@/*` path alias, producing ~30 `Cannot find module` errors.
  It is not part of the shipping app.
- `tsconfig.json` (current, full):
  ```jsonc
  {
    "extends": "expo/tsconfig.base",
    "compilerOptions": {
      "strict": true,
      "paths": {
        "@/*": ["./src/*"],
        "@/assets/*": ["./assets/*"]
      }
    },
    "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
    "exclude": ["**/*.test.ts", "**/*.test.tsx"]
  }
  ```
  Note there is **no top-level `exclude` of `example/` or `node_modules`**, so
  `**/*.ts` sweeps the scaffold.

Repo convention: recent commits use short imperative subject lines with no
conventional-commit prefix (e.g. `Consolidate sign-in switching into a User
Session Entry module`). Match that.

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`      | fewer errors (see steps) |
| Grep      | `grep -rln "<pattern>" src`              | as noted per step   |
| Tests     | `npm test`                               | 1 suite, 10 tests pass |

## Scope

**In scope** (the only files you should modify or delete):
- `src/OLD_apiClass.ts` (delete)
- `src/api/track-builder.ts` (delete)
- `tsconfig.json` (add `example` to `exclude`)

**Out of scope** (do NOT touch):
- Anything inside `example/` — leave the directory on disk; just stop
  type-checking it. (It is referenced by `npm run reset-project`; deleting it is
  a separate decision.)
- The ~9 real `src/` type errors (FlashList, dropdown spread, segmented-control,
  etc.) — those are fixed in plans 002 and 003. Do not fix them here.
- `package.json` dependencies — do not add `axios` or
  `react-native-track-player`; the files are being deleted, not revived.

## Git workflow

- Branch: `advisor/001-remove-dead-code`
- One commit is fine; message e.g. `Remove dead OLD_apiClass and track-builder, scope tsc off example scaffold`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the dead files have no importers

Run both greps and confirm each returns **only the file itself**:

```
grep -rln "OLD_apiClass" src
grep -rln "track-builder\|buildTrackPlayerTracks" src
```

**Verify**: first returns only `src/OLD_apiClass.ts`; second returns only
`src/api/track-builder.ts`. If either returns any *other* file, **STOP** — there
is a live importer and these are not dead.

### Step 2: Delete the two dead files

```
git rm src/OLD_apiClass.ts src/api/track-builder.ts
```

**Verify**: `git status` shows both files staged for deletion; `npm test` still
passes (1 suite, 10 tests).

### Step 3: Exclude the starter scaffold from type-checking

Edit `tsconfig.json` so the `exclude` array also excludes `example` and the
standard `node_modules`:

```jsonc
"exclude": ["node_modules", "example", "**/*.test.ts", "**/*.test.tsx"]
```

**Verify**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c '^example/'` →
`0`. And `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'OLD_apiClass'` → `0`.

### Step 4: Confirm only the real errors remain

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS'
```

**Verify**: the remaining errors are confined to these files only —
`src/app/chapter-viewer.tsx`, `src/components/bookComponents/active-download-toast-coordinator.tsx`,
`src/components/bookComponents/book-filter-results-sheet.tsx`,
`src/components/main-player/main-player-sheet-stub.tsx`,
`src/shared/ui/organisms/dropdown/index.tsx`,
`src/shared/ui/organisms/segmented-control/index.tsx`.
No `example/`, no `OLD_apiClass`, no `track-builder`. (These remaining errors are
fixed in plans 002 and 003 — do not fix them here.) If errors appear in files
*not* on this list, note them in your report.

## Test plan

No new tests. This plan only deletes unreferenced code and narrows the
typechecker. Regression guard: `npm test` must still pass (the one existing
suite must be unaffected).

## Done criteria

- [ ] `src/OLD_apiClass.ts` and `src/api/track-builder.ts` no longer exist
- [ ] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE '^example/|OLD_apiClass|track-builder'` → `0`
- [ ] `npm test` exits 0 (1 suite, 10 tests)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- Step 1 finds any importer of either dead file — they are not actually dead.
- After Step 3, `tsc` shows errors in `src/` files **not** in the Step 4 list —
  the codebase has drifted; report the new error locations.
- `npm test` fails after deletion (it should not — the files are unreferenced).

## Maintenance notes

- Whoever later decides the fate of `example/` should know `npm run
  reset-project` (`scripts/reset-project.js`) interacts with it; this plan only
  stopped type-checking it, it did not remove it.
- A reviewer should confirm via `git grep` that nothing imported the deleted
  files, and that the `tsconfig` `exclude` change did not accidentally stop
  type-checking real `src/` code (it should not — `example` is a sibling of
  `src`).
