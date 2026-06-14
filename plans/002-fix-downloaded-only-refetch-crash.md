# Plan 002: Fix the crash when retrying chapter load in Downloaded-Only mode

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 48350c6..HEAD -- src/hooks/abs-data-hooks.ts src/app/chapter-viewer.tsx`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (can run independently; recommended after 001 so `tsc` output is readable)
- **Category**: bug
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

`useGetItemDetails` returns a React Query result object, but on its
**unauthenticated** code path it hand-builds a partial object that omits
`refetch` (and every other query method). The chapter viewer destructures
`refetch` and wires it to a "Retry" button. So in **Downloaded-Only Mode** (no
signed-in User Session) or **Signed-Out Required Sign-In**, if chapter data
fails to load and the user taps Retry, the app calls `undefined()` and crashes.
This is also one of the real `tsc` errors (`refetch` is not on the returned
union). Per `CONTEXT.md`, Downloaded-Only Mode is a first-class supported state
("locally downloaded audiobooks remain available without a signed-in User
Session"), so a crash there is a real defect.

## Current state

- `src/hooks/abs-data-hooks.ts` — defines `useGetItemDetails`. The authenticated
  return path spreads `...rest` (the live query object) but the unauthenticated
  path does not. Current code, `abs-data-hooks.ts:444-468`:
  ```ts
  // Return appropriate data based on authentication state
  if (status !== "authenticated") {
    return {
      data:
        accessMode === "downloadedOnly" || accessMode === "downloadedSessionOnly"
          ? downloadedFallback
          : undefined,
      isPending: false,
      isError: false,
      isLoading: false,
      error: null,
    };
  }
  const shouldUseDownloadedFallback = Boolean(downloadedFallback && !details);
  const resolvedData = shouldUseDownloadedFallback ? downloadedFallback : data;
  return {
    data: resolvedData,
    isPending: shouldUseDownloadedFallback ? false : isPending,
    isError: shouldUseDownloadedFallback ? false : isError,
    isLoading: shouldUseDownloadedFallback ? false : isLoading,
    error: shouldUseDownloadedFallback ? null : error,
    ...rest,            // <-- present here, MISSING in the unauthenticated branch above
  };
  ```
  `...rest` is the remainder of the underlying `useQuery(...)` result and
  includes `refetch`. (Find where `data`, `isPending`, `error`, `...rest` are
  destructured from `useQuery` earlier in the same function — typically
  `const { data, isPending, isError, isLoading, error, ...rest } = useQuery(...)`
  — to confirm `refetch` lives in `rest`.)

- `src/app/chapter-viewer.tsx:44` destructures it:
  ```ts
  const { data: bookData, isLoading, isError, refetch } = useGetItemDetails(routeLibraryItemId);
  ```
  and `chapter-viewer.tsx:218-220` calls it on the error-state Retry button:
  ```tsx
  <Pressable
    accessibilityRole="button"
    onPress={() => refetch()}
  ```

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|----------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`                | no error mentioning `refetch` or `chapter-viewer.tsx:44` |
| Tests     | `npm test`                                         | all suites pass     |
| Grep      | `grep -n "refetch" src/app/chapter-viewer.tsx`     | confirms call site  |

## Scope

**In scope**:
- `src/hooks/abs-data-hooks.ts` (make `refetch` always available)
- `src/app/chapter-viewer.tsx` (make the call site safe regardless)

**Out of scope** (do NOT touch):
- The other `tsc` errors in `chapter-viewer.tsx` (e.g. `FlashList` used as a
  type on line 42) — those belong to plan 003. Only the `refetch`/line-44 error
  is yours. If fixing `refetch` does not clear line 42, leave line 42 for 003.
- The behavior of the authenticated path — do not change what it returns.
- Other consumers of `useGetItemDetails` — verify they still typecheck, but do
  not refactor them.

## Git workflow

- Branch: `advisor/002-refetch-crash`
- Message e.g. `Fix crash when retrying chapter load without a signed-in session`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make `refetch` available on the unauthenticated return

In `src/hooks/abs-data-hooks.ts`, the unauthenticated branch must expose a
callable `refetch`. The underlying query still exists even when the hook chooses
to return fallback data, so spreading `...rest` (which carries `refetch`) into
the unauthenticated return is the correct, minimal fix. Change the
unauthenticated branch to include `...rest`, keeping the explicit overrides:

```ts
if (status !== "authenticated") {
  return {
    data:
      accessMode === "downloadedOnly" || accessMode === "downloadedSessionOnly"
        ? downloadedFallback
        : undefined,
    isPending: false,
    isError: false,
    isLoading: false,
    error: null,
    ...rest,
  };
}
```

Note: the explicit keys (`data`, `isPending`, `isError`, `isLoading`, `error`)
appear **before** `...rest`. Confirm `rest` does not itself contain those five
keys (it should not — they were destructured out). If spreading `...rest`
re-introduces one of them and overrides your explicit value, **STOP** and report
— the destructure shape differs from this plan's assumption.

**Verify**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "refetch"` → `0`.

### Step 2: Defensively guard the call site

Even with Step 1, make the Retry button robust. In
`src/app/chapter-viewer.tsx:220`, change `onPress={() => refetch()}` to:

```tsx
onPress={() => refetch?.()}
```

This is belt-and-suspenders so the button can never call `undefined`.

**Verify**: `grep -n "refetch?.()" src/app/chapter-viewer.tsx` returns line ~220.

### Step 3: Full typecheck + tests

**Verify**:
- `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "abs-data-hooks|chapter-viewer.tsx\(44" ` → no output (the line-44 `refetch` error is gone). The unrelated `chapter-viewer.tsx:42` FlashList error MAY still be present — that is expected and owned by plan 003.
- `npm test` → all suites pass.

## Test plan

Add a focused unit test for `useGetItemDetails`'s contract that `refetch` is a
function in every auth state.

- New file: `src/hooks/__tests__/abs-data-hooks.test.ts`
- Model its mocking structure after the existing
  `src/auth/__tests__/enter-user-session.test.ts` (uses `jest.mock(...)` for each
  dependency, then `jest.requireActual` where partial). You will need to mock the
  hook's dependencies (auth store, the items query, downloaded-fallback inputs).
  Because `useGetItemDetails` is a React hook, render it with a minimal test
  harness — check whether `@testing-library/react-native` or
  `@testing-library/react-hooks` is available (`grep -r "testing-library"
  package.json`). **If no React hook-testing library is installed, do NOT add
  one** — instead, extract the auth-state branching into a tiny pure helper
  (e.g. `selectItemDetailsResult(args)`) within `abs-data-hooks.ts`, export it,
  and unit-test that helper directly. Note which path you took in your report.
- Cases to cover:
  - authenticated → result includes a callable `refetch`
  - unauthenticated + `downloadedOnly` → `data` is the fallback **and** `refetch`
    is a callable function (the regression this plan fixes)
  - unauthenticated + not downloaded → `data` is `undefined` and `refetch` is
    still a callable function
- **Verify**: `npm test` → all pass including the new cases.

## Done criteria

- [ ] `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c refetch` → `0`
- [ ] `grep -n "refetch?.()" src/app/chapter-viewer.tsx` → matches line ~220
- [ ] New test file exists and `npm test` passes with the 3 new cases
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The destructure of `useQuery` in `useGetItemDetails` does not put `refetch`
  into `...rest` (e.g. the function destructures `refetch` explicitly) — the fix
  shape differs; report the actual destructure.
- Spreading `...rest` into the unauthenticated branch overrides one of the five
  explicit keys.
- No hook-testing library is installed AND the branching cannot be cleanly
  extracted into a pure helper without touching out-of-scope behavior.

## Maintenance notes

- The root cause is a hand-built partial query-result object that drifts from the
  real React Query shape. A reviewer should watch for the same anti-pattern in
  the other hooks in `abs-data-hooks.ts` (any branch that returns a literal
  instead of spreading the query result risks the same missing-method bug).
- Deferred: auditing the other hooks in this file for the same omission — out of
  scope here to keep the change reviewable.
