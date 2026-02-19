# Authentication Implementation Plan

## Goals
- Securely store ABS username, password, server URL, and auth tokens for reauthentication and token refresh.
- Allow immediate app access on launch if the user has ever logged in or has downloaded content, regardless of connectivity.
- Prefer refresh-token authentication whenever possible; fall back to username/password only when refresh fails.
- Make API calls aware of auth state so they can no-op or exit gracefully when unauthenticated.

## Key Constraints & Requirements
- Must persist username, password, and server URL securely on device.
- App entry must not be blocked by offline state or token validity if the user has logged in before.
- If no stored credentials but offline downloads exist, the user should still be allowed into the app (offline-only mode).

## Proposed Architecture
### Storage
- Use `expo-secure-store` for sensitive values: `absUsername`, `absPassword`, `absServerUrl`, `accessToken`, `refreshToken`, `lastAuthAt`.
- Store offline-download metadata in `device-books-store.ts` and expose a derived `hasOfflineContent` boolean via `selectHasOfflineContent`.

Notes:
- `expo-secure-store` provides encrypted, local key-value storage, backed by Android Keystore and iOS Keychain. It is designed for securely storing credentials and tokens. See references section for details.

### Auth Store (Zustand)
- Create a dedicated `authStore` with small, focused scope.
- Export only custom hooks, use atomic selectors, and separate actions from state to avoid unnecessary re-renders and keep actions static.
- Model actions as events (e.g., `hydrate`, `loginSuccess`, `refreshFailed`) rather than setters.

Suggested State Shape
- `status`: `"hydrating" | "anonymous" | "authenticated" | "offlineOnly"`
- `hasStoredCredentials`: boolean
- `hasOfflineContent`: boolean
- `accessToken`: string | null
- `refreshToken`: string | null
- `serverUrl`: string | null
- `lastAuthError`: string | null
- `isOnline`: boolean | null

Suggested Actions (examples)
- `hydrateFromStorage()`
- `setOnlineStatus(isOnline)`
- `loginWithPassword(username, password, serverUrl)`
- `refreshSession()`
- `logout()`
- `enterOfflineOnlyMode()`

### Auth Flow (Startup)
1. `hydrateFromStorage()` runs on app launch.
2. Read SecureStore for stored credentials/tokens and set `hasStoredCredentials`.
3. Read `device-books-store.ts` to set `hasOfflineContent` by checking downloaded device content.
4. App entry decision:
   - If `hasStoredCredentials` is true, set `status = authenticated` immediately (even if offline).
   - If `hasStoredCredentials` is false but `hasOfflineContent` is true, set `status = offlineOnly` and allow app entry.
   - If both are false, set `status = anonymous` and route to login.
5. If online and refresh token exists, attempt `refreshSession()` in background after entry.
6. If refresh fails and stored username/password exist, attempt `loginWithPassword()`.
7. If both refresh and password login fail, keep user in app but set `status = offlineOnly` if `hasOfflineContent` is true, otherwise move to login.

### Token Refresh Strategy
- Always attempt refresh when an access token is missing/expired.
- Use a single in-flight refresh promise to avoid concurrent refresh calls.
- Only fall back to password login when refresh fails or refresh token is missing.
- Persist refresh-token rotation by always storing the latest `refreshToken` returned by `/auth/refresh` or `/login`.
 - Preemptively refresh based on JWT expiry (when expiry is available) instead of waiting for 401s.

### ABS Auth Endpoints (from discussion #4460)
- `POST /login`
  - Request header: `x-return-tokens: true` for mobile clients (to receive refresh tokens).
  - Response: `accessToken` and `refreshToken`.
- `POST /auth/refresh`
  - Request header: `x-refresh-token: <refreshToken>`.
  - Response: same as `/login` (accessToken + refreshToken). Only includes refreshToken if header is present.
- `POST /logout`
  - Request header: `x-refresh-token: <refreshToken>` to invalidate the active refresh token.

### API Client Behavior
- Wrap `fetch` with an `authFetch` that checks `authStore` for `status`, `accessToken`, and `serverUrl`.
- If `status` is `anonymous` or `offlineOnly`, return a typed error early or skip request.
- If `status` is `authenticated` but token is missing/expired, attempt refresh before sending the request.
- Always include server URL from SecureStore or store state to avoid drift between login and API calls.

### Connectivity Awareness
- Track network status and store `isOnline`.
- When offline, skip refresh attempts and mark auth as `offlineOnly` if no valid token exists.
- When connectivity returns, trigger a background refresh (and if that fails, attempt password login using stored credentials).

## Implementation Steps
1. Create `authStorage` module to encapsulate SecureStore reads/writes and key names.
2. Create `authStore` with the state and actions above following Zustand best practices.
3. Implement `authService` for login, refresh, and token validation (pure functions used by store actions).
4. Add an `authFetch` (or API client) that reads `authStore` state and handles graceful exits.
5. Integrate store hydration into app startup (e.g., app layout) and route based on `status`.
6. Add offline-content check and a light UI indicator for offline-only mode.

## Testing Scenarios
- First launch, no credentials, no downloads -> login screen.
- First launch, no credentials, downloads exist -> offline-only app entry.
- Returning user offline with stored refresh token -> app entry and background refresh skipped.
- Returning user online with expired access token -> refresh succeeds and API calls proceed.
- Refresh fails, password succeeds -> app remains authenticated.
- Refresh fails, password fails, downloads exist -> app stays offline-only.

## Open Questions
- None at this time.

## Current Implementation Notes
- `useAuthBootstrap` drives startup hydration, connectivity wiring, and bookmark queue sync.
- `auth-store` persists `activeLibraryId`, `activeLibraryName`, and `activeLibraryUserKey`.
- `device-books-store` owns offline queue/bookmark notes/download state and is consulted for `hasOfflineContent`.

## References
- [Working with Zustand](https://tkdodo.eu/blog/working-with-zustand)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [react-native-netinfo](https://github.com/react-native-netinfo/react-native-netinfo)
- [Audiobookshelf Auth Discussion #4460](https://github.com/advplyr/audiobookshelf/discussions/4460)
