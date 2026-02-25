# Audiobookshelf Auth Flow

This document describes the authentication flow for Audiobookshelf in this app. The flow is implemented across `src/auth` and `src/api`.

## Key Files

- `src/auth/auth-store.ts`: Central auth state (Zustand), session refresh logic, and login/logout actions.
- `src/auth/auth-service.ts`: Low-level HTTP calls for login/refresh/logout.
- `src/auth/auth-storage.ts`: SecureStore persistence for credentials and tokens.
- `src/api/auth-fetch.ts`: Auth-aware fetch wrapper used by all API calls.
- `src/api/abs-client.ts`: Public API client wrapper that normalizes auth/offline errors.

## Storage Responsibilities

**SecureStore (sensitive data)**
- `auth-storage.ts` stores:
  - `username`, `password`, `serverUrl`
  - `accessToken`, `refreshToken`

**MMKV + Zustand persist (non-sensitive, app state)**
- `auth-store.ts` persists:
  - `activeLibraryId`
  - `activeLibraryName`
  - `activeLibraryUserKey`
- `device-books-store.ts` persists device-only book data:
  - downloads + local cover URIs
  - per-user-book playback rates
  - offline progress sync queue
  - offline bookmark create/delete queues
  - local bookmark notes

## State Model (auth-store)

`authStore` maintains:
- `status`: `hydrating` | `anonymous` | `authenticated` | `offlineOnly`
- `isOnline`: network status flag
- `storedUsername`, `serverUrl`
- `accessToken`, `refreshToken`, `accessTokenExpiresAt`
- `loginRequired`, `lastAuthError`
- `activeLibraryId`, `activeLibraryName`, `activeLibraryUserKey` (persisted via MMKV)

## Login Flow

1. UI calls `authStore.actions.loginWithPassword(username, password, serverUrl)`.
2. `authService.login()` sends `POST /login` with `x-return-tokens: true`.
3. Response is parsed into `accessToken` and `refreshToken`.
4. `auth-storage` stores credentials and tokens in SecureStore.
5. `auth-store` updates runtime state and transitions `status` to `authenticated`.

## Hydration Flow

1. On app startup, call `authStore.actions.hydrateFromStorage()`.
2. Credentials and tokens are loaded from SecureStore.
3. `useAuthBootstrap` derives `hasOfflineContent` from `device-books-store`.
4. `status` becomes:
   - `authenticated` if a session exists
   - `offlineOnly` if there’s offline content but no session
   - `anonymous` otherwise

## Bootstrap Side Effects

`useAuthBootstrap` also:

- Subscribes to `NetInfo` and updates `authStore.isOnline`.
- Attempts `refreshSession()` when online and a refresh token exists.
- Captures a background progress snapshot through AppState when a book is loaded.
- Flushes pending offline queues from `device-books-store` when authenticated and online:
  1. pending progress sync
  2. pending bookmark creates
  3. pending bookmark deletes

## Authenticated API Call Flow

All API calls should go through `absClient`, which uses `authFetch`.

1. API module calls `absClient.get/post/patch/...`.
2. `absClient.request()` delegates to `authFetch(path, options)`.
3. `authFetch` checks auth state:
   - If `status === "anonymous"`: throw `AuthUnavailableError("UNAUTHENTICATED")`.
   - If `isOnline === false`: throw `AuthUnavailableError("OFFLINE")`.
   - If `serverUrl` missing: throw `AuthUnavailableError("MISSING_SERVER_URL")`.
4. `authFetch` ensures a valid access token:
   - If token is valid and unexpired, it’s used.
   - Otherwise it calls `authStore.actions.refreshSession()`.
5. Request is issued with `Authorization: Bearer <token>`.
6. On `401`, `authFetch` forces a token refresh and retries once.

## Token Refresh Flow

`authStore.actions.refreshSession({ force })`:
1. If online and token is valid, returns existing token (unless `force`).
2. If token is expired or `force`, refresh is attempted:
   - If `refreshToken` is present: `authService.refresh()` via `POST /auth/refresh`.
   - If refresh fails: fallback to stored credentials and re-login via `POST /login`.
3. If both refresh and re-login fail:
   - SecureStore tokens cleared
   - `loginRequired` set to `true`
   - state transitions to `anonymous` or `offlineOnly` (if offline content exists)

## Logout Flow

1. UI calls `authStore.actions.logout()`.
2. Best-effort `authService.logout()` via `POST /logout` with `x-refresh-token`.
3. SecureStore tokens and password are cleared.
4. State is reset and `activeLibraryId` cleared.

## Error Handling

`absClient` maps auth/network errors to standardized errors:
- `AbsOfflineError`: device offline
- `AbsAuthRequiredError`: login required or token refresh failed
- `AbsApiError`: all other HTTP failures

These errors can be handled in UI screens for messaging and recovery.

## Recommended Usage

- Use `authStore.actions.hydrateFromStorage()` during app bootstrap.
- Use `absClient` for all authenticated API calls.
- Set `authStore.actions.setOnlineStatus()` based on `NetInfo`.
- Read `authStore.getState().loginRequired` to prompt login when needed.
