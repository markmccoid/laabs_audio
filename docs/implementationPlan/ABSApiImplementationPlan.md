# Audiobookshelf API Access Plan

## Goals
- Ensure every API call adds the access token automatically.
- If the access token is expired, refresh it automatically and retry the request.
- If refresh fails, alert the user that they must log in.
- Abort API calls when the device is offline.
- Provide a clean foundation for ABS endpoints (starting with `/api/libraries`).

## Constraints and Guidance
- Prefer `fetch` over Axios for Expo; keep a single request wrapper that acts like an interceptor.
- Use the ABS JWT endpoints described in the Audiobookshelf discussion:
  - `POST /login` with `x-return-tokens: true` to receive refresh tokens in the response body.
  - `POST /auth/refresh` with `x-refresh-token` header.
  - `POST /logout` with `x-refresh-token` header.
- The public API docs are explicitly marked as out-of-date; use them only for endpoint shapes and paths.
- Target ABS servers >= 2.26.0 (JWT auth only), no legacy token compatibility.
- Non-auth network errors should fail fast (no retry/backoff).

## Proposed Architecture
### 1. Central ABS Client (Interceptor Equivalent)
Create a single `absClient` module that exports `request`, `get`, `post`, etc. It should:
- Use the existing auth state (access token + refresh token + server URL).
- Check online status before issuing a request and throw an `OfflineError` when offline.
- Attach `Authorization: Bearer <accessToken>` for authenticated requests.
- If token is expired (or near expiry), refresh first; if refresh fails, raise `AuthRequiredError` and trigger a user-facing alert.
- If a request returns `401`, attempt a forced refresh and retry once.

This is functionally identical to Axios interceptors but keeps the dependency graph light and aligns with Expo fetch usage.

### 2. Auth Failure Handling
- When refresh fails, update auth state so UI can show a “Login required” bottom sheet.
- Always redirect to the login route, but present it as a bottom sheet so navigation and offline-only views remain usable underneath.
- Streaming actions should require login; offline-only actions remain available.

### 3. Error Model
Standardize errors returned from the client:
- `OfflineError` (device offline)
- `AuthRequiredError` (refresh failed or no valid session)
- `ApiError` (non-401 HTTP errors, include status and body)

### 4. Typed API Modules
Create endpoint-specific modules that call `absClient`:
- `librariesApi.getAll()` -> `GET /api/libraries`
- Additional modules later (`usersApi`, `itemsApi`, etc.)

## ABS Endpoint Stub (Example)
### `GET /api/libraries`
From the ABS docs, this endpoint returns a JSON object with a `libraries` array.

Planned stub signature (plan-only):
```
getAllLibraries(): Promise<{ libraries: Library[] }>
```

Minimal `Library` shape (plan-only):
```
type Library = {
  id: string;
  name: string;
  mediaType: "book" | "podcast";
  provider: string;
  displayOrder: number;
  settings: {
    coverAspectRatio: number;
    disableWatcher: boolean;
    skipMatchingMediaWithAsin: boolean;
    skipMatchingMediaWithIsbn: boolean;
    autoScanCronExpression: string | null;
  };
  createdAt: number;
  lastUpdate: number;
};
```

## Implementation Steps
1. Add `absClient` wrapper (request + helper methods) that uses auth state and enforces offline checks.
2. Add global error handling to surface `AuthRequiredError` using an Expo Router bottom sheet and route to login.
3. Create `librariesApi` module using `absClient`.
4. Add a basic data hook or action to fetch libraries and store them (later integrate with state).
5. Add tests (or test harness) for:
   - Offline abort
   - Expired token refresh success
   - Refresh failure -> alert + login required
   - 401 retry flow

## Clarifying Questions
- None at this time.
