# Audiobookshelf Auth Flow

How authentication, multiple sign-ins, and sign-in switching work. Implemented across
`src/auth` and `src/api`. Use the vocabulary from [../CONTEXT.md](../CONTEXT.md) — especially
**User Session**, **Remembered User Session**, **Session Entry Option**, **User Session Entry**,
**Session Entry Resolution**, and **Listening State Owner**. The key behavioral decision is
recorded in [ADR-0020](./adr/0020-single-user-session-entry-module.md) (and identity ownership in
[ADR-0015](./adr/0015-audiobookshelf-user-identity-owns-local-listening-state.md)).

## Key Files

- `src/auth/auth-store.ts` — central auth state (Zustand) + session-commit primitives, token
  refresh, hydration, and logout.
- `src/auth/auth-storage.ts` — persistence: the remembered-sessions snapshot (MMKV) and per-session
  secrets (SecureStore).
- `src/auth/auth-service.ts` — low-level HTTP for `login` / `refresh` / `logout`.
- `src/auth/enter-user-session.ts` — **User Session Entry**: the one module that establishes a
  signed-in session from either Session Restoration or credentials (sign-in *and* switching).
- `src/auth/use-apply-session-entry-resolution.ts` — maps a Session Entry Resolution to navigation
  and Library Activation (keeps `enterUserSession` navigation-free).
- `src/auth/session-boundary.ts` — crosses the User Session boundary (capture + teardown) when the
  active identity changes.
- `src/auth/listening-owner.ts` — resolves the **Listening State Owner** for an audiobook.
- `src/auth/library-resolution.ts` — post-entry Library Resolution (zero / one / many).
- `src/api/auth-fetch.ts`, `src/api/abs-client.ts` — auth-aware fetch + error normalization.
- Screens: `src/components/auth/sign-in-list-screen.tsx` (switch), `sign-in-edit-screen.tsx`
  (edit + re-enter), `sign-in-form-screen.tsx` (add via credentials).

## Identity model (read this first)

LAABS stores **multiple** sign-ins and switches between them. Two concepts, often confused:

- **Remembered User Session** — identified by the **Audiobookshelf User Identity** (the server's
  user UUID). It owns all durable local listening state (bookmarks, progress, rate, listening
  position). This is the durable identity.
- **Session Entry Option** — a saved *way to restore* a session: a `serverUrl + username` pair. Its
  storage key is `getSessionKey(username, serverUrl)` = `v2.<enc serverUrl>.<enc username>`. Multiple
  Entry Options may restore the **same** User Identity (e.g. the same user via a LAN URL and a public
  URL). The Server Connection Endpoint is used for API calls only — never for local-state identity.

## Storage responsibilities

**SecureStore — per-session secrets**, keyed `abs.session.<sessionKey>.<password|accessToken|refreshToken>`
(`getSessionSecrets` / `setSessionSecrets`). There is no longer a single global credential slot; the
pre-multi-session `abs.username/password/...` keys exist only so the one-time migration
(`migrateLegacySessionIfNeeded`, `clearLegacySession`) can wipe them.

**MMKV — the remembered-sessions snapshot** under `abs.sessions`:
`{ sessions: RememberedSessionRecord[], activeSessionKey, migrationVersion }`. A
`RememberedSessionRecord` is `{ key, userId, username, serverUrl, label, activeLibraryId,
activeLibraryName, needsAttention, lastError, createdAt, updatedAt }`.

**MMKV — Zustand persist (`auth-store`)** persists only `activeLibraryId`, `activeLibraryName`,
`activeLibraryUserKey`, and `storedUserId`. `device-books-store` persists device-only data (downloads,
per-user rates, offline sync queues, local bookmark notes, playlist projections).

## State model (`auth-store`)

`authStore` holds: `status` (`hydrating` | `anonymous` | `authenticated` | `offlineOnly`), `isOnline`,
`storedUsername`, `storedUserId`, `serverUrl`, `accessToken`, `refreshToken`, `accessTokenExpiresAt`,
`hasStoredCredentials`, `hasOfflineContent`, `loginRequired`, `lastAuthError`, `rememberedSessions`,
`activeSessionKey`, and `activeLibraryId/Name/UserKey`.

Actions: `hydrateFromStorage`, `setOnlineStatus`, `setHasOfflineContent`, `setLoginRequired`,
`setActiveLibrary`, `clearActiveLibrary`, **`commitActiveSession`**, **`setSessionNeedsAttention`**,
`updateRememberedSession`, `removeRememberedSession`, `refreshSession`, `logout`.

`selectAccessMode` derives the **Access Mode** (the only thing root routing should branch on) — see
[auth-library-flow-technical.md](./auth-library-flow-technical.md).

> Note: there is no `loginWithPassword` / `restoreRememberedSession` action anymore. All sign-in and
> switching goes through `enterUserSession` (below), which authenticates, then calls the small
> `commitActiveSession` primitive. Screens never sequence the steps themselves.

## User Session Entry — sign-in *and* switching

`enterUserSession(request): Promise<SessionEntryResolution>` is the single entry path. The request is
discriminated:

- `{ via: "restore", sessionKey }` — restore a Remembered User Session (used by the list and edit
  screens; this is how **switching** happens).
- `{ via: "credentials", username, password, serverUrl, label? }` — sign in with typed credentials
  (used by the add-sign-in form).

It runs five phases in a fixed order so a failed or interrupted entry never leaves the user worse off
than before they tried:

1. **Authenticate.** `restore`: try the remembered refresh token, then the remembered password as a
   fallback (verifying the returned User Identity matches). `credentials`: `authService.login`. A
   `NETWORK_ERROR` ⇒ `failed{ kind: "offline" }`; a restore where neither token nor password works
   ⇒ `setSessionNeedsAttention` + `failed{ kind: "needsAttention" }`. **No teardown happens here**, so
   the previous session is untouched on failure.
2. **Persist (inactive).** Save the new session record + secrets — but do *not* make it active yet.
3. **Cross the boundary.** `prepareForSignInChange({ userId, sessionKey })` (see below).
4. **Commit (atomic switch-over).** `commitActiveSession` flips `activeSessionKey` and mirrors the
   identity into state. This is the single point where the active session changes.
5. **Resolve the library.** `fetchLibrariesForResolution` + `resolveLibrarySelection` produce a
   `SessionEntryResolution`.

`SessionEntryResolution` =
`{ outcome: "activate"; library }` | `{ outcome: "needsLibrarySelection" }` |
`{ outcome: "noLibraries"; message }` | `{ outcome: "failed"; kind; message; sessionKey? }`.

`enterUserSession` is **navigation-free** and guards against concurrent entries (one in flight at a
time). Callers use `useApplySessionEntryResolution()` to turn the outcome into navigation: `activate`
runs the shared `activateLibrarySelection` (Library Activation, ADR-0009); `needsLibrarySelection`
pushes `/library-picker`; `noLibraries`/`failed` surface the message (the list/edit screens
additionally open the edit form on a non-offline failure).

### Crossing the User Session boundary (`session-boundary.ts`)

`prepareForSignInChange` decides how much to tear down, using the **confirmed** identity:

- **Same User Identity** (e.g. switching endpoints for the same user) — tear down only streaming
  playback; downloaded playback and identity-scoped state stay.
- **Different User Identity** — `prepareForUserSessionBoundary`: end Active Playback (after capturing a
  Progress Sync Intent), clear Library Activation, and clear the session-scoped React Query cache.

It only ever tears down **live runtime state** — never durable, identity-scoped data (bookmarks,
progress intents, downloads). Capture-before-cross + persist-before-commit is why a failed switch is
fully recoverable.

### The three sign-in screens

- **List** (`sign-in-list-screen`): shows Remembered User Sessions; the active one has the green
  corner checkmark badge. Tapping a non-active row → `enterUserSession({ via: "restore" })` (switch).
- **Edit** (`sign-in-edit-screen`): `updateRememberedSession` (label/password), then re-enters via
  `enterUserSession({ via: "restore" })` only when the edited session is active or needs attention.
- **Form** (`sign-in-form-screen`): add a new sign-in → `enterUserSession({ via: "credentials" })`.

## Listening State Owner (`listening-owner.ts`)

Many surfaces need "which User Identity owns this audiobook's local listening state right now." That is
the **Listening State Owner**: the signed-in / remembered identity when present, otherwise the
audiobook's Downloaded Audio Asset Owner. Resolve it in one place:

- `useResolvedListeningOwnerKey(libraryItemId?)` — reactive, for components.
- `resolveListeningOwnerKey(libraryItemId?)` — pure, for services (player-service, session-boundary,
  progress-sync-intent-store).

Do not re-spell `activeLibraryUserKey ?? storedUserId ?? downloadOwner` inline; use these.

## Hydration

1. On startup `useAuthBootstrap` calls `hydrateFromStorage(hasOfflineContent)`.
2. `auth-store` runs the legacy migration, loads the active session record + its secrets, and computes
   `status`/Access Mode.
3. `useAuthBootstrap` also: subscribes to `NetInfo`, attempts `refreshSession()` when online with a
   refresh token, captures background progress via AppState, and flushes offline queues (progress →
   bookmark deletes → bookmark creates → playlist ops) when authenticated and online.

## Authenticated API calls

All calls go through `absClient` → `authFetch`, which throws `AuthUnavailableError` for
anonymous/offline/missing-server, ensures a valid token (refreshing if needed), issues
`Authorization: Bearer`, and retries once on `401` after a forced refresh.

## Token refresh (`refreshSession({ force })`)

1. If online and the token is valid, return it (unless `force`).
2. Otherwise `authService.refresh` via `POST /auth/refresh`; on failure fall back to the active
   session's stored password and re-login.
3. If both fail: clear that session's tokens, set `needsAttention` + `loginRequired`, and transition
   to `anonymous`/`offlineOnly`.

## Logout

Coordinated by `useExplicitLogout`: `prepareForUserSessionBoundary` (snapshot progress, end playback,
clear caches), then `authStore.actions.logout` — best-effort `POST /logout`, clears tokens **and
credentials for every Session Entry Option of the signed-out User Identity**, clears the Active
Library, and clears the active pointer. Downloaded files, local bookmark records, and identity-scoped
Progress Sync Intents remain on disk. Routes to required Login.

## Error handling

`absClient` maps to `AbsOfflineError`, `AbsAuthRequiredError`, and `AbsApiError` for UI messaging.

## Recommended usage

- Bootstrap with `hydrateFromStorage()`; route from `selectAccessMode`, not raw `status`.
- Sign in / switch / re-enter via `enterUserSession` + `useApplySessionEntryResolution` — never
  hand-sequence authenticate/commit/resolve in a screen.
- Resolve listening-state ownership via `useResolvedListeningOwnerKey` / `resolveListeningOwnerKey`.
- Use `absClient` for all authenticated calls.

## Tests

`enterUserSession` is covered by `src/auth/__tests__/enter-user-session.test.ts` (jest-expo; run
`npm test`). The tests assert the phase ordering and the switching rules (failed login leaves the
previous session intact, offline, needs-attention, library-resolution branches, concurrency).
