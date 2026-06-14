# Plan 003: Clear the remaining real TypeScript errors in `src/`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 48350c6..HEAD -- src/app/chapter-viewer.tsx src/components/bookComponents/active-download-toast-coordinator.tsx src/components/bookComponents/book-filter-results-sheet.tsx src/components/main-player/main-player-sheet-stub.tsx src/shared/ui/organisms/dropdown/index.tsx src/shared/ui/organisms/segmented-control/index.tsx`
> If any in-scope file changed, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: 001 (dead code removed so `tsc` output is readable), 002 (owns the `chapter-viewer.tsx:44` `refetch` error)
- **Category**: correctness
- **Planned at**: commit `48350c6`, 2026-06-14

## Why this matters

After plans 001 and 002, a handful of genuine type errors remain in `src/`.
Each is a place the compiler caught a real mismatch (a duplicated prop, a value
used as a type, an untyped route string, an animated-component generic). Clearing
them makes `npx tsc --noEmit` exit 0 — which is the prerequisite for wiring a
typecheck gate in plan 004. Without a green baseline, the gate cannot be turned
on.

## Current state

Run `npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS'` to see the live
list. As of commit `48350c6` (after 001 + 002), the errors are (plan 001 exposed
two additional pre-existing errors now included here):

0. **`src/app/_layout.tsx:26`** — `TS2882: Cannot find module or type
   declarations for side-effect import of '../global.css'`. Current:
   ```ts
   import "../global.css";
   ```
   This is a Tailwind CSS global import via `tailwindcss`/`uniwind`. The package
   is present in `package.json`. Fix: add a `.d.ts` module declaration so TS
   accepts `.css` side-effect imports. Create (or add to) `expo-env.d.ts` (it
   already exists at the repo root):
   ```ts
   declare module "*.css";
   ```
   Alternatively, check if `expo/tsconfig.base` already handles `.css` and
   something went wrong — `grep -r "css" node_modules/expo/tsconfig.base.json`.
   Do the minimal fix that makes the error go away without `@ts-ignore`.

1. **`src/app/chapter-viewer.tsx:42`** — `FlashList` (a value) used as a type:
   ```ts
   const listRef = useRef<FlashList<ChapterListItem>>(null);
   ```
   `FlashList` is imported as a value/component. Fix: use the instance type. With
   `@shopify/flash-list` v2, use `useRef<React.ComponentRef<typeof FlashList>>(null)`
   (or `useRef<FlashListRef<ChapterListItem>>(null)` if `FlashListRef` is
   exported by the installed version — check
   `node_modules/@shopify/flash-list` exports before choosing).

2. **`src/components/bookComponents/active-download-toast-coordinator.tsx:216`**
   — `description` specified twice (`TS2783`). Current code, lines 212-218:
   ```ts
   if (toast.isActive(toastId)) {
     toast.update(toastId, {
       type: "loading",
       title,
       description,
       ...options,
     });
   ```
   `options` (built at lines 155-210) already contains `description` (line 160),
   computed from the **same** `description` variable. So the line-216
   `description` is redundant and overwritten by `...options`. The two values are
   identical — this is dead duplication, **not** a behavior bug. Fix: delete the
   redundant `description,` on line 216 (keep `type` and `title`, which are *not*
   in `options`).

3. **`src/components/bookComponents/book-filter-results-sheet.tsx:139`** — a
   plain `string` passed to `router.push`, which expects expo-router's typed
   route union. Current code, lines 131-140:
   ```ts
   const destination =
     sourceTab === "search"
       ? `/(tabs)/search/${libraryItemId}`
       : `/(tabs)/(home)/${libraryItemId}`;
   router.back();
   setTimeout(() => {
     router.push(destination);
   }, 0);
   ```
   Fix: give `destination` the right type. Prefer casting at the boundary —
   `router.push(destination as Href)` (import `Href` from `expo-router`) — unless
   you can find how other call sites in this repo type dynamic routes (`grep -rn
   "router.push(" src | head`); match the prevailing pattern if one exists.

4. **`src/components/main-player/main-player-sheet-stub.tsx:54`** — a `string`
   passed where `SymbolView`'s `name` expects an `SFSymbols7_0` union. Current:
   ```tsx
   <SymbolView name={icon} size={26} tintColor={themeColors.accent} />
   ```
   `icon` is typed as `string`. Fix: narrow `icon`'s type to the symbol union at
   its source (preferred — find where the `icon` prop/variable is declared in
   this file and type it as `SFSymbolName`/`SFSymbols7_0` imported from
   `expo-symbols`), or cast at the boundary `name={icon as SFSymbols7_0}` if the
   value is genuinely dynamic. Do not suppress with `@ts-ignore` (the repo has
   zero of those — keep it that way).

5. **`src/shared/ui/organisms/dropdown/index.tsx:275`** — spread of a possibly
   non-object (`TS2698`). Current:
   ```tsx
   ? React.cloneElement(child, { ...child.props, index } as any)
   ```
   `child.props` is typed `unknown`. The `as any` is already present but TS still
   flags the spread. Fix: type the element so its props are an object —
   `Children.map(children, (child, index) => React.isValidElement<Record<string, unknown>>(child) ? React.cloneElement(child, { ...child.props, index }) : child)`.
   Removing the `as any` in favor of a typed `isValidElement<...>` is preferred;
   if that proves too invasive, cast `child.props` to `object`:
   `{ ...(child.props as object), index }`.

6. **`src/components/bookComponents/book-quick-actions.tsx:136`** — `TS2493:
   Tuple type '[string]' of length '1' has no element at index '1'`. Current:
   ```ts
   const sourceBookRoute: BookDetailRouteSource = segments[1] === "search" ? "search" : "home";
   ```
   `segments` from `useSegments()` is typed as a tuple with fewer elements than
   expected. Fix: check what `useSegments()` returns at this call site (the tabs
   layout means `segments[0]` is `(tabs)`, `segments[1]` is the tab name). Either
   widen the `segments` type with an index signature, or use optional chaining:
   `segments[1] === "search"` → `(segments as string[])[1] === "search"` (boundary
   cast, not `@ts-ignore`). Match how other files handle `useSegments` in this repo:
   `grep -rn "useSegments" src | head`.

7. **`src/shared/ui/organisms/segmented-control/index.tsx`** — multiple:
   - line 19: `Animated.createAnimatedComponent<Partial<BlurViewProps>>(BlurView)`
     — the generic argument is wrong for this overload. Fix: drop the explicit
     generic and let it infer — `Animated.createAnimatedComponent(BlurView)` —
     then type the resulting component where used, or pass the component type as
     the generic the way reanimated 4 expects (check another
     `createAnimatedComponent` usage in the repo: `grep -rn
     "createAnimatedComponent" src`).
   - lines ~163, ~207: `StyleSheet.absoluteFillObject` does not exist on this RN
     version — it's `StyleSheet.absoluteFill`. Replace `absoluteFillObject` with
     `absoluteFill` (the compiler suggests this exact fix).
   - line ~210: a `Partial<BlurViewProps>` style/intensity assignment that fails
     once line 19 is corrected — re-check after fixing line 19; it may resolve.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`       | exit 0, no errors   |
| Tests     | `npm test`                                | all suites pass     |
| Lint      | `npx expo lint`                           | no NEW errors introduced in touched files |

## Scope

**In scope** (only these files):
- `src/app/_layout.tsx` (only the `global.css` import — item #0)
- `expo-env.d.ts` (may add a `.css` module declaration — item #0)
- `src/app/chapter-viewer.tsx` (only the line-42 FlashList type — line-44
  `refetch` is plan 002's)
- `src/components/bookComponents/active-download-toast-coordinator.tsx`
- `src/components/bookComponents/book-filter-results-sheet.tsx`
- `src/components/bookComponents/book-quick-actions.tsx` (item #6)
- `src/components/main-player/main-player-sheet-stub.tsx`
- `src/shared/ui/organisms/dropdown/index.tsx`
- `src/shared/ui/organisms/segmented-control/index.tsx`

**Out of scope**:
- Any runtime behavior change. These are type-only fixes; the rendered output and
  control flow must be identical. (Exception: deleting the redundant duplicate
  `description` in #2 — verified to be the same value, so still no behavior
  change.)
- Adding `@ts-ignore` / `@ts-expect-error` anywhere — the repo has none; do not
  introduce the first one. Prefer precise types, then narrow casts (`as X`) only
  at boundaries.
- The lint errors (set-state-in-effect, eqeqeq) — those are plan 005.

## Git workflow

- Branch: `advisor/003-typecheck-clean`
- Commit per file or one commit; message e.g. `Resolve remaining src TypeScript errors`
- Do NOT push or open a PR unless instructed.

## Steps

Fix the six items above in order. After **each** file, run
`npx tsc --noEmit -p tsconfig.json 2>&1 | grep '<that-file>'` and confirm its
errors are gone before moving on. Prefer the "narrow the type at its source"
option over a boundary cast wherever the source is local and obvious; fall back
to a documented boundary `as` cast otherwise.

**Verify (final)**: `npx tsc --noEmit -p tsconfig.json` → **exit 0, no output**.

## Test plan

No new behavioral tests — these are type-only corrections. Regression guard:
`npm test` must still pass. For item #2 (the toast duplicate), manually confirm
by reading lines 155-218 that the deleted `description` equalled
`options.description` (both come from the `description` variable at line 133)
before deleting — record that confirmation in your report.

## Done criteria

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 with no output
- [ ] `npm test` exits 0
- [ ] `grep -rn "@ts-ignore\|@ts-expect-error" src` → `0` matches (none added)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- After 001+002, `tsc` shows errors in files **not** listed in "Current state"
  — the codebase drifted; report the new locations rather than guessing fixes.
- Any fix would require changing runtime behavior to satisfy the type (e.g. the
  route string in #3 is actually invalid at runtime, not just untyped).
- The installed `@shopify/flash-list` version exports neither `FlashListRef` nor
  accepts `React.ComponentRef<typeof FlashList>` — report the available ref type
  from its `.d.ts`.

## Maintenance notes

- Once this lands, `tsc --noEmit` is green and plan 004 can wire it as a gate.
  After that, these errors cannot silently return.
- A reviewer should confirm every fix is type-only (diff should show no changed
  string literals, conditionals, or JSX structure except the deleted duplicate
  `description`).
