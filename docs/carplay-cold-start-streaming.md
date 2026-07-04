# Why streaming fails on a CarPlay cold start — analysis and implementation plan

_Written 2026-07-03/04, current as of commit `bdbff49` (Attempt F). Companion to
`docs/carplay-debugging-log.md`._

> **Status update (2026-07-04): Phases 1 and 2 are IMPLEMENTED** (plus the Phase-2 risk-list
> hardening: token-refresh persist failures no longer discard in-memory tokens). Phase 3
> (NetInfo seed, per-error alert copy) remains optional/unimplemented. Verification per the
> phase checklists below is pending hardware testing; the desk-rig check for Phase 1 is a
> headless cold launch streaming a non-downloaded book with the phone unlocked.

## Executive summary

Streaming a book from a headless CarPlay cold launch fails because **auth hydration is a React
side effect, and React never mounts headless**. `authStore` boots with `status: "hydrating"`
and `serverUrl: null`, and the only caller of `hydrateFromStorage()` is the `useAuthBootstrap`
hook mounted by `src/app/_layout.tsx`. On a car-initiated launch there is no window scene, no
layout pass, and no React tree — so the store stays un-hydrated forever, and the first
authenticated request throws `AuthUnavailableError: MISSING_SERVER_URL`.

This is a **deliberate-looking architectural seam, not a deep limitation**: everything the
streaming path needs (server URL, tokens, refresh flow) is already stored on-device and already
works without any UI once the store is hydrated. The fix is to make hydration callable from the
headless entry path. One secondary blocker (Keychain accessibility while the phone is locked)
needs a one-line storage option plus a migration. A clear, low-risk implementation plan is at
the end.

## Evidence

Hardware capture `logs/carplay/carplay-20260703-230041.log` (headless cold launch, phone app
never opened):

```text
23:00:49  [CarPlay] service initialized            ← JS booted headless (bundle-scope init)
23:01:09  [CarPlay] book selected 2e78b7aa-…       ← non-downloaded book tapped
23:01:09  [CarPlay] requestStart failed
          { [AuthUnavailableError: Missing server URL] code: 'MISSING_SERVER_URL' }
```

The failure is ~50 ms after the tap — a synchronous guard, not a network failure. Notably
absent from every headless capture: any `[auth-store] hydrate:start` / `[auth-bootstrap]` line.
Hydration never ran.

## The blocking chain, exactly

| # | Step | File / line | What happens headless |
| - | ---- | ----------- | --------------------- |
| 1 | App cold-launched by the car | `index.js` → `src/carplay/carplay-init.ts` | Bundle-scope `initCarPlayService()` runs; React never mounts (documented in carplay-init's header comment) |
| 2 | Auth store boots | `src/auth/auth-store.ts:91–97` | Initial state `status: "hydrating"`, `serverUrl: null`, `accessToken: null` |
| 3 | The only hydration trigger | `src/auth/use-auth-bootstrap.ts:50` → called from `src/app/_layout.tsx:164` | `hydrateFromStorage()` lives behind a React `useEffect` → **never invoked headless** |
| 4 | Persisted slice doesn't help | `auth-store.ts` `partialize` (end of file) | Only `activeLibraryId/Name/UserKey` + `storedUserId` are zustand-persisted — **serverUrl and tokens are intentionally excluded** (secrets live in SecureStore, session metadata in MMKV `abs.sessions`) |
| 5 | User taps a non-downloaded book | `src/player/player-service.ts:527` (Attempt F preflight) | `playbackApi.getPlayInfo()` → `absClient` → `authFetch` |
| 6 | The guard that throws | `src/api/auth-fetch.ts:90–92` | `provider.getServerUrl()` returns `null` → `AuthUnavailableError("Missing server URL", "MISSING_SERVER_URL")` |
| 7 | UX fallback | `src/carplay/carplay-service.ts:328` | Alert: "Open LAABS on your phone to stream this book" (current playback stays intact since Attempt F) |

Two guards *pass* by luck of their defaults, which is why the failure is specifically
`MISSING_SERVER_URL`:

- `auth-fetch.ts:82` (`UNAUTHENTICATED`): fires only when `status === "anonymous"`; headless
  status is `"hydrating"` → passes.
- `auth-fetch.ts:87` (`OFFLINE`): fires only when `isOnline === false`; headless it is `null`
  (the NetInfo listener is also inside `useAuthBootstrap`) → passes.

## What already works in our favor

- **Session metadata (incl. `serverUrl`) is in MMKV** (`abs.sessions`,
  `src/auth/auth-storage.ts:163`) — synchronously readable headless. The device-books store
  already proves MMKV works at bundle scope (the Downloaded fallback shelf builds headless).
- **`hydrateFromStorage()` has no UI dependency.** It reads MMKV + SecureStore, computes
  status, and `set()`s the store. Nothing in it touches React, windows, or navigation.
- **Token refresh is store-level, single-flighted, and UI-free**
  (`auth-store.ts:425+`): refresh token → `authService.refresh`; falls back to stored
  password login. `authFetch` calls it automatically on expiry.
- **Attempt F made failure safe.** The streamed preflight runs before teardown, so wiring
  hydration up cannot make things worse than today's alert.
- **Progress/resume already headless-proof** via the CarPlay resume snapshot (no React Query
  needed to start at the right position).

## Blocker 2 (latent): Keychain accessibility while the phone is locked

Secrets (password, access token, refresh token) are stored via `expo-secure-store` with **no
`keychainAccessible` option** (`src/auth/auth-storage.ts:57–59`), which defaults to
`WHEN_UNLOCKED`. In the real-car scenario the phone is usually **locked** in a pocket:

- `SecureStore.getItemAsync` for a `WHEN_UNLOCKED` item **fails while locked** → even with
  hydration wired up, `hydrateFromStorage()` would land in its catch block (`auth-store.ts:210+`)
  and set `status` per `computeEntryStatus(false, …)` → streaming still refused.
- Token-refresh **write-backs** while locked would fail the same way.

The fix is `keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK` — the standard setting for
apps that do background work. The device must have been unlocked once since boot (true in
practice: you unlocked it at some point before getting in the car). Note this only affects
**newly written** items; existing installs need a one-time rewrite migration.

CarPlay-Simulator desk testing usually has the phone unlocked, so Blocker 1 can be fixed and
verified independently of Blocker 2 — but Blocker 2 **will** bite in a real car if skipped.

## What would need to change, and blast radius

### Change 1 — Headless auth hydration (the core fix)

**Where:** `src/carplay/carplay-init.ts` (or a sibling `headless-bootstrap.ts` it imports),
plus a small guard inside `auth-store.ts`.

**What:** call `authStore.getState().actions.hydrateFromStorage()` at bundle scope, and make
the action **single-flight** (memoize the in-flight promise; concurrent callers await the same
run) so the bundle-scope call and `useAuthBootstrap`'s call (`use-auth-bootstrap.ts:50`) can't
interleave their `set()`s.

**Blast radius: small, but it touches every normal app start.**

- Normal (phone) launches now start hydration ~at bundle evaluation instead of ~at first React
  effect — strictly earlier, same code path, same single consumer semantics. The
  `useAuthBootstrap` effect re-runs hydration when `hasOfflineContent` flips; with
  single-flight it either joins the in-flight run or re-runs afterward — both are what happens
  today, just with the interleaving race removed (a latent bug fixed, not added).
- Startup-metrics markers (`markStartup("auth-hydrate-start")`) shift earlier; harmless, but
  the startup dashboard numbers will move.
- `hasOfflineContent` hint: the bundle-scope call should pass the same hint the hook computes
  (`selectHasOfflineContent(deviceBooksStore.getState(), …)`); device-books hydrates from MMKV
  synchronously, so this works headless.
- No API, navigation, or UI changes. No native changes.

### Change 2 — Keychain accessibility + migration

**Where:** `src/auth/auth-storage.ts:57–60` (the `getItem`/`setItem`/`deleteItem` helpers).

**What:** pass `{ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }` on writes, and add a
one-time migration: on the next successful foreground hydrate, re-write the active session's
secrets so existing installs pick up the new accessibility class.

**Blast radius: small.**

- Security posture: secrets become readable after first unlock instead of only while unlocked.
  This is the accepted standard for background-capable apps (background audio, pushes).
- Migration is a rewrite of values that are already in memory post-hydrate; failure leaves the
  old accessibility (no data loss), and the migration retries next launch.
- All SecureStore call sites go through the two helpers, so the option lands in one place.

### Change 3 — Optional polish (not required for the fix)

- Seed `isOnline` headless with a one-shot `NetInfo.fetch()` in the headless bootstrap so a
  truly-offline car session fails fast with the OFFLINE message instead of a network timeout.
  Tiny; isolated.
- The CarPlay alert for non-downloaded books could differentiate "no account/session" from
  "couldn't reach your server" using `AuthUnavailableError.code` at
  `carplay-service.ts:328`. Cosmetic.

### What does NOT need to change

- `auth-fetch.ts` guards — correct as-is once the store is hydrated.
- Token refresh, `playbackApi.getPlayInfo`, track-source building, the CarPlay templates, the
  player service switch path (Attempt F already reordered it), progress sync (it already
  queues offline via device-books).
- No native (Swift) changes; no Info.plist/entitlement changes; no new background modes.

## Implementation plan

### Phase 1 — Single-flight hydration + headless call (the fix)

1. **`src/auth/auth-store.ts`**: add a module-level `let hydratePromise: Promise<void> | null`
   (same pattern as the existing `refreshPromise` at line ~87). Wrap the body of
   `hydrateFromStorage` so concurrent callers share one run:

   ```ts
   hydrateFromStorage: async (initialOfflineContent) => {
     if (hydratePromise) return hydratePromise;
     hydratePromise = (async () => { /* existing body */ })().finally(() => {
       hydratePromise = null;
     });
     return hydratePromise;
   },
   ```

   Deliberate behavior change to call out in review: today two overlapping calls both run and
   interleave `set()`s; with this, the second caller awaits the first. `useAuthBootstrap`'s
   re-run on `hasOfflineContent` change still re-hydrates (the promise has cleared by then).

2. **`src/carplay/carplay-init.ts`**: after `initCarPlayService()`, add:

   ```ts
   import { authStore } from "../auth/auth-store";
   import { deviceBooksStore, selectHasOfflineContent } from "../store/device-books-store";

   // Headless auth hydration — React never mounts on a car-initiated cold
   // launch, so useAuthBootstrap's hydrate never runs. Without this, any
   // streamed selection dies with MISSING_SERVER_URL (see
   // docs/carplay-cold-start-streaming.md).
   const authState = authStore.getState();
   const userKey = authState.activeLibraryUserKey ?? authState.storedUserId; // persisted slice
   const offlineHint = selectHasOfflineContent(deviceBooksStore.getState(), userKey);
   void authState.actions.hydrateFromStorage(offlineHint).catch(() => {});
   ```

   The user key mirrors `useAuthBootstrap`'s `resolvedUserKey` and comes from the
   zustand-persisted auth slice (`activeLibraryUserKey`/`storedUserId` ARE in `partialize`).
   Caveat: zustand persist rehydration may not have completed at bundle evaluation — if the
   key reads null, pass `undefined`; the hint only affects the anonymous-vs-offlineOnly status
   for users with **no** stored session, so getting it wrong headless is inconsequential (a
   stored session always yields `authenticated`).

3. **Trace it**: log `hydrate:start/done` through the CarPlay `log()` mirror or keep the
   existing `[auth-store]` logs — they are `console.log`-based and visible in Release captures.

**Verification (CarPlay Simulator + `scripts/carplay-log-capture.sh`):**
- Kill LAABS, cold-launch from CarPlay with the phone **unlocked**, tap a non-downloaded book.
  Expected: `hydrate:done status=authenticated` near boot, then
  `loadBook:session-resolved … kind=streamed` and audio. The Attempt F alert should no longer
  appear (network available).
- Regression: normal phone launch → sign-in state, session switching, and library activation
  all unchanged; startup logs show one hydrate run, not two.
- Regression: headless cold start with a **downloaded** book — unchanged behavior.

### Phase 2 — Keychain accessibility (real-car hardening)

1. `src/auth/auth-storage.ts`: change the helpers:

   ```ts
   const SECURE_OPTS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
   const getItem = (key: string) => SecureStore.getItemAsync(key, SECURE_OPTS);
   const setItem = (key: string, value: string) => SecureStore.setItemAsync(key, value, SECURE_OPTS);
   const deleteItem = (key: string) => SecureStore.deleteItemAsync(key, SECURE_OPTS);
   ```

   (`keychainAccessible` matters on writes; passing the same options object everywhere keeps
   get/delete consistent with how the items were written.)

2. Migration: add `migrationVersion` bump handling in `authStorage` (the snapshot already
   carries `migrationVersion`, `auth-storage.ts:30`) — on first hydrate at the new version,
   read each stored secret and re-`setItem` it, then record the bump. Skip (and retry next
   launch) if any read fails.

**Verification:** requires a real device: lock the phone, cold-launch from CarPlay (or CarPlay
Simulator with the phone locked), stream a book. Also verify sign-in/sign-out and session
switching still round-trip secrets.

### Phase 3 — Optional polish

- One-shot `NetInfo.fetch()` in the headless bootstrap to seed `isOnline`.
- Distinct alert copy per `AuthUnavailableError.code` in `showStartFailureAlert`.

### Effort estimate

| Phase | Size | Risk |
| ----- | ---- | ---- |
| 1 | ~30 lines across 2 files | Low — single-flight guard is the only semantic change on the normal path |
| 2 | ~15 lines + migration (~30 lines) | Low-medium — Keychain migrations need careful failure handling; test on-device |
| 3 | ~20 lines | Trivial |

### Risks and mitigations

- **Double hydration race on normal launches** — eliminated by the single-flight guard
  (Phase 1.1); this is a strict improvement over today.
- **Bundle-scope import cycles** (`carplay-init` → `auth-store` → …): auth-store has no import
  back into carplay; `listening-owner` is the one to watch. If a cycle appears, compute the
  offline hint inline or drop it.
- **SecureStore at background launch, device unlocked**: reads work (Keychain is available;
  only the accessibility class gates locked access). Phase 1 is testable without Phase 2.
- **Streamed session server-side lifecycle**: a headless-started stream opens an ABS session;
  close-on-switch already goes through `syncProgress`/`closeSession`, which queue offline —
  no new handling needed.
- **Token refresh write-back while locked** (Phase 2 world): `refreshSession` persists new
  tokens; if a locked-device write fails it throws inside the refresh — check that
  `commitActiveSession`/`saveTokens` failures don't clear good in-memory tokens; if they do,
  wrap the persist in a try/catch that keeps the in-memory tokens (small hardening inside
  Phase 2).

## Bottom line

The app is one missing function call away from headless streaming: hydration was coupled to
React mount, and the CarPlay entry path deliberately runs without React. Phase 1 removes that
coupling with a single-flight guard and a bundle-scope call (~30 lines, low risk, no native
changes) and is independently testable on the desk rig. Phase 2 (Keychain accessibility) is
required before trusting it in a real locked-phone car scenario.
