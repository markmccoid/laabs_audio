# Plan 005: Clear the 61 ESLint errors and make lint a hard gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `npx expo lint 2>&1 | tail -5` to see the current
> error/warning counts, and compare against the "Current state" numbers below.
> Large divergence means the codebase drifted — re-scope before proceeding.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW–MED (some `set-state-in-effect` fixes touch render behavior)
- **Depends on**: 004 (the gate exists; this plan makes its lint step blocking)
- **Category**: correctness / dx
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

`npx expo lint` reports **61 errors + 39 warnings**, unenforced. Most are not
cosmetic: `react-hooks/set-state-in-effect` flags effects that call `setState`
synchronously, causing cascading re-renders (a real perf and correctness smell on
a list-heavy mobile app); `react-hooks/refs` flags reading/writing refs during
render. Clearing these and then flipping lint to blocking (in `verify` and the
lefthook hook) stops the backlog from regrowing. The eqeqeq warnings are trivial
autofixes.

## Current state

Run `npx expo lint` for the live list. As of commit `48350c6`, notable items:

- **`react-hooks/set-state-in-effect`** (errors) — effects calling `setState` in
  the body. Known locations include:
  - `src/store/store-filters.ts:410` — `setLocalSearchValue(storeSearchValue)`
    inside `useEffect(() => {...}, [storeSearchValue])` (the debounced-search
    local/store sync).
  - `src/app/player-rate.tsx:48`
  - `src/components/Home/bookshelf/bookshelf-detail-screen.tsx:62`
  - `src/components/bookComponents/book-key-details.tsx:55`
- **`react-hooks/refs`** (errors) — including `src/store/store-filters.ts:402`
  ("Passing a ref to a function may read its value during render").
- **`eqeqeq`** (warnings) — `src/utils/formatUtils.ts:13,80,81,82,84,85` use `==`.
- Plus assorted fixable warnings (import order, unused vars). `npx expo lint`
  reports "0 errors and 7 warnings potentially fixable with the `--fix` option."

## Commands you will need

| Purpose       | Command                          | Expected on success |
|---------------|----------------------------------|---------------------|
| Lint          | `npx expo lint`                  | exit 0 by end of plan |
| Lint autofix  | `npx expo lint --fix`            | reduces fixable items |
| Typecheck     | `npm run typecheck`              | exit 0 (must stay green) |
| Tests         | `npm test`                       | all pass            |
| Count errors  | `npx expo lint 2>&1 \| tail -3`  | shows running totals |

## Scope

**In scope**: any `src/**` file flagged by `expo lint`, plus `package.json` /
`lefthook.yml` for the final "make blocking" step. Work in passes (autofix →
mechanical → behavioral) as below.

**Out of scope**:
- Refactoring beyond what the lint rule requires. Fix the violation; do not
  redesign the component.
- The `tsc` errors (plans 001–003) — they must stay fixed, not regress.
- Disabling rules wholesale in `eslint.config.js`. Per-line
  `// eslint-disable-next-line <rule> -- <reason>` is allowed ONLY with a written
  justification, and only as a last resort for a false positive (see STOP).

## Git workflow

- Branch: `advisor/005-lint-clean`
- Commit per pass (autofix / mechanical / each behavioral file); messages e.g.
  `Fix react-hooks set-state-in-effect in store-filters`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Autofix the mechanical violations

```
npx expo lint --fix
```
Then `git diff` and review: this should fix import order, the 7 fixable
warnings, and possibly the `eqeqeq` warnings in `formatUtils.ts`. If `eqeqeq`
remains, change each `==`/`!=` to `===`/`!==` in
`src/utils/formatUtils.ts:13,80,81,82,84,85` — but first confirm each comparison
is not intentionally loose (e.g. `x == null` catching both null and undefined).
For `x == null` checks, the correct strict form is `x === null || x === undefined`
or keep `== null` with an inline disable + reason if that idiom is used
elsewhere in the repo (`grep -rn "== null" src | head`).

**Verify**: `npm run typecheck` still exit 0; `npm test` still passes;
`npx expo lint 2>&1 | tail -3` shows a lower count.

### Step 2: Fix `react-hooks/refs` violations

For each `refs` error (e.g. `store-filters.ts:402`, where a ref is passed into a
`debounce(...)` factory), apply the standard fix: do not read `ref.current`
during render or pass the ref where it will be read at render time. Typical fix
is to read the ref inside the debounced callback (already deferred) and ensure
the `useMemo`/`useCallback` that builds the debounced function does not itself
dereference the ref. Make the minimal change that satisfies the rule **without
changing the debounce timing behavior**.

**Verify**: the specific file no longer appears under `react-hooks/refs` in
`npx expo lint`; `npm test` passes.

### Step 3: Fix `react-hooks/set-state-in-effect` violations

These are the higher-risk fixes — each effect that calls `setState`
synchronously. For each location, apply the React-recommended pattern in
priority order:
1. **Derive instead of sync**: if the state is fully computable from props/other
   state, remove the state + effect and compute the value during render
   (often the right fix for "sync local state with a store value").
2. **Key-reset**: if it resets state when an input changes, use a `key` on the
   component or the `useState` initializer pattern.
3. If neither applies and the effect genuinely synchronizes an external system,
   keep it but ensure the setState is conditional (only when the value actually
   changed) — and if the rule still flags it and the effect is correct, use a
   scoped `// eslint-disable-next-line react-hooks/set-state-in-effect -- <why>`
   with a real justification.

Do these **one file at a time**, verifying after each. For
`store-filters.ts:410` (local search value synced from store): prefer option 1/2
— the local input value can often be derived or key-reset rather than mirrored in
an effect. If changing it risks the debounced-search UX, **STOP** and report
rather than guessing — search behavior is user-facing and has a real test gap.

**Verify** after each file: `npx expo lint 2>&1 | tail -3` count drops; `npm
test` passes; manually confirm (read the diff) the component's behavior is
preserved.

### Step 4: Make lint a blocking gate

Once `npx expo lint` exits 0:
- In `package.json`, ensure `verify` uses `npm run lint` (not the non-blocking
  `lint:gate` from plan 004). Remove `lint:gate` if it exists.
- The lefthook `lint-staged` job from plan 004 already runs eslint on staged
  files — confirm it is present and not disabled.

**Verify**: `npm run verify` exits 0 with lint blocking; `npx expo lint; echo
"exit=$?"` → `exit=0`.

## Test plan

No new unit tests are required by the lint rules themselves, BUT: the
`set-state-in-effect` fix in `store-filters.ts` touches user-facing search
behavior that currently has **no test**. If you change `store-filters.ts`, add a
minimal test for the debounced-search reducer/selector logic if it can be
isolated as a pure function; if it cannot be isolated without a hook harness,
note the coverage gap in your report and rely on the STOP condition above to
avoid risky changes. Model any new test after
`src/auth/__tests__/enter-user-session.test.ts`.

## Done criteria

- [ ] `npx expo lint` exits 0 (0 errors, 0 warnings — or warnings only with a
      documented, agreed allowlist)
- [ ] `npm run typecheck` still exits 0 (no regressions from 001–003)
- [ ] `npm test` exits 0
- [ ] `npm run verify` exits 0 with lint blocking
- [ ] `grep -rn "eslint-disable" src` — every instance has a `-- <reason>` comment
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- A `set-state-in-effect` fix would change user-visible behavior you cannot
  verify (especially the debounced search in `store-filters.ts`) — report the
  options rather than guessing.
- The live lint count diverges wildly from "61 errors + 39 warnings" — the repo
  drifted; re-scope.
- A fix requires touching a file already owned by an unmerged plan (001–004) in a
  conflicting way.

## Maintenance notes

- After this lands, the lefthook `lint-staged` job keeps new code clean. A
  reviewer should scrutinize the `set-state-in-effect` diffs most — those are the
  only behavioral ones; the rest are mechanical.
- Deferred: the `react-hooks` rules surfaced real render-churn smells; a deeper
  pass to remove derived-state-in-effect across the Home/Library screens is worth
  a future plan but is out of scope here.
