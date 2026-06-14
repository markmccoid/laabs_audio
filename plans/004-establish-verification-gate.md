# Plan 004: Establish a one-command verification gate (typecheck + lint + test) enforced on commit

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 48350c6..HEAD -- package.json lefthook.yml`
> If either changed, compare the "Current state" excerpts against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001, 002, 003 (typecheck must be green before it can gate); 005 may follow to make lint gating strict
- **Category**: dx
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

There is no automated gate on this repo: no `typecheck` script, no CI
(`.github/workflows` absent), and `lefthook.yml` is present but **entirely
commented out**, so no git hook runs. That is precisely why type errors and lint
violations accumulated. Once plans 001–003 make `tsc` green, this plan adds a
single `npm run verify` command and a `lefthook` pre-commit hook so regressions
are caught locally before they land. This is the durable fix — every later plan
benefits from a working feedback loop.

## Current state

- `package.json` scripts today:
  ```json
  "scripts": {
    "start": "expo start",
    "reset-project": "node ./scripts/reset-project.js",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "postinstall": "patch-package",
    "lint": "expo lint",
    "test": "jest"
  }
  ```
  There is **no `typecheck` and no `verify` script.**
- `lefthook.yml` is **100% comments** (every line starts with `#`). `lefthook` is
  not currently wired. Confirm whether the binary is installed:
  `npx lefthook version` (it is an indirect dependency of some Expo toolchains;
  if absent, see Step 3's fallback).
- `tsconfig.json` excludes test files, so `tsc --noEmit` type-checks app code.
  There is also a `tsconfig.test.json` — inspect it; it likely extends the base
  to include tests. Use `tsconfig.json` for the gate (app code).
- The pre-existing test suite: `npm test` → 1 suite, 10 tests, passes.

## Commands you will need

| Purpose      | Command                              | Expected on success |
|--------------|--------------------------------------|---------------------|
| Typecheck    | `npx tsc --noEmit -p tsconfig.json`  | exit 0, no output (after 001–003) |
| Lint         | `npx expo lint`                      | runs (may still warn — see Step 2) |
| Tests        | `npm test`                           | all pass            |
| Lefthook ver | `npx lefthook version`               | prints a version, or errors if absent |

## Scope

**In scope**:
- `package.json` (add scripts)
- `lefthook.yml` (replace commented sample with a real config)
- `.github/workflows/verify.yml` (create — optional, Step 4, only if the operator
  wants CI; otherwise skip and note it)

**Out of scope**:
- Fixing lint errors — that is plan 005. This plan wires lint into the loop but
  must NOT make a currently-failing lint block commits until 005 lands (see Step
  2 for how to stage this).
- Any source code under `src/`.
- Changing `tsconfig` (plan 001 already scoped it).

## Git workflow

- Branch: `advisor/004-verification-gate`
- Message e.g. `Add verify script and lefthook pre-commit gate`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `typecheck` and `verify` scripts

In `package.json` `scripts`, add:

```json
"typecheck": "tsc --noEmit -p tsconfig.json",
"verify": "npm run typecheck && npm run lint && npm test"
```

**Verify**: `npm run typecheck` → exit 0, no output (requires 001–003 landed —
if it errors, those plans are not yet merged; **STOP** and report).

### Step 2: Decide lint strictness (staged, non-blocking first)

`npx expo lint` currently reports 61 errors + 39 warnings (cleaned up in plan
005). If `verify` hard-fails on lint now, the gate is unusable until 005 lands.
Stage it:

- Keep `"lint": "expo lint"` as-is in `verify` **only if** plan 005 has already
  landed and `npx expo lint` exits 0. Check: `npx expo lint; echo "exit=$?"`.
- If lint still fails (exit non-zero), make the gate's lint step
  non-blocking for now by using a dedicated script that does not fail the build,
  and leave a TODO tied to plan 005:
  ```json
  "lint": "expo lint",
  "lint:gate": "expo lint || echo '⚠️ lint has known violations — see plans/005'"
  ```
  and use `lint:gate` inside `verify` instead of `lint`. Once 005 lands, switch
  `verify` back to `npm run lint` (record this as a follow-up in your report).

**Verify**: `npm run verify; echo "exit=$?"` → exits 0 (typecheck + test pass;
lint is either clean or non-blocking per the staging decision above).

### Step 3: Wire a lefthook pre-commit hook

First confirm lefthook is available: `npx lefthook version`.

- **If available**, replace the entire contents of `lefthook.yml` with:
  ```yaml
  pre-commit:
    parallel: true
    jobs:
      - name: typecheck
        run: npx tsc --noEmit -p tsconfig.json
      - name: lint-staged
        glob: "*.{ts,tsx}"
        run: npx eslint {staged_files}
      - name: test
        run: npm test
  ```
  Then install the hooks: `npx lefthook install`.
  **Verify**: `cat .git/hooks/pre-commit` exists and references lefthook; make a
  trivial no-op commit on the branch and confirm the hooks run
  (`git commit --allow-empty -m "chore: verify lefthook runs"` → you see
  typecheck/lint/test jobs execute).

- **If `npx lefthook version` errors** (not installed): do NOT add it as a new
  dependency without operator sign-off (installs mutate the lockfile). Instead,
  STOP and report that lefthook is unavailable, leaving the `verify` script
  (Step 1–2) as the manual gate. Note in your report that enabling the hook
  requires `npm install --save-dev lefthook`.

### Step 4 (optional): GitHub Actions CI

Only do this if the operator asked for CI. If yes, create
`.github/workflows/verify.yml`:

```yaml
name: verify
on:
  pull_request:
  push:
    branches: [master]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```
(Lint is omitted from CI until plan 005 makes it green; add `- run: npm run lint`
then.)

**Verify**: file is valid YAML (`npx js-yaml .github/workflows/verify.yml` or a
YAML linter if available). Do NOT push to trigger it unless instructed.

## Test plan

No new unit tests. The "test" of this plan is that the gate runs:
- `npm run verify` exits 0.
- A no-op commit on the branch triggers the lefthook jobs (if lefthook is
  available).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run verify` exits 0
- [ ] `lefthook.yml` contains a real `pre-commit` config (not comments) AND
      `npx lefthook install` succeeded — OR a report explains lefthook is
      unavailable and why the hook step was skipped
- [ ] If CI was requested: `.github/workflows/verify.yml` exists and is valid YAML
- [ ] No `src/` files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `npm run typecheck` fails — plans 001–003 are not fully landed; this plan
  cannot proceed.
- `lefthook` is not installed (do not add it silently — report and let the
  operator decide).
- The pre-commit hook makes commits impossibly slow (`npm test` + `tsc` on every
  commit) — report so the operator can move test to pre-push instead.

## Maintenance notes

- Once plan 005 makes lint clean, switch `verify` to use `npm run lint` (not the
  non-blocking `lint:gate`) and add lint to CI — this is the deferred follow-up.
- If commits become slow, move the `test` job from `pre-commit` to a `pre-push`
  section in `lefthook.yml` (keep typecheck + lint on pre-commit, which are fast).
- A reviewer should confirm the hook actually blocks a bad commit: temporarily
  introduce a type error, attempt a commit, confirm it is rejected, then revert.
