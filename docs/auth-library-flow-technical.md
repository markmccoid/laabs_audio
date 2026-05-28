# Authentication and Library Selection Technical Flow

This document describes the current Authentication, Access Mode, Library Resolution, Library Selection, and Library Activation flow.

## Domain Terms

- **User Session**: authenticated relationship between one user and one Audiobookshelf Server.
- **Library Resolution**: determining whether the User Session has zero, one, or multiple Libraries.
- **Library Selection**: the user-facing choice of which Library becomes the Active Library.
- **Library Activation**: preparing a chosen Library for browsing before committing it as the Active Library.
- **Active Library**: the Library used for Home, Search, shelves, and library-scoped queries.
- **Access Mode**: the app surfaces currently available to the user.

## Session State and Access Mode

`AuthStatus` is stored in `src/auth/auth-store.ts`.

| AuthStatus | Meaning |
| --- | --- |
| `hydrating` | Auth state is being restored from storage. |
| `anonymous` | No usable User Session is present. |
| `authenticated` | A remembered or signed-in User Session exists. |
| `offlineOnly` | Server browsing is unavailable. Downloaded access is allowed only when a remembered User Session identity is still present and sign-in is required. |

`AccessMode` is derived by `selectAccessMode`.

| AccessMode | Condition | Available surfaces |
| --- | --- | --- |
| `hydrating` | `status === "hydrating"` | Startup/loading only. |
| `firstRunSignInRequired` | No usable or remembered User Session | Forced sign-in. Downloaded Audio Assets are not exposed. |
| `downloadedOnly` | Deprecated legacy mode | Must not be returned for explicit signed-out state. |
| `downloadedSessionOnly` | Server access is blocked, remembered session identity exists, downloaded content exists | Session-scoped downloads and sign-in/recovery surfaces. |
| `serverSetup` | `authenticated` with no Active Library | Library Resolution or Library Selection required. |
| `serverBrowsing` | `authenticated` with an Active Library | Home, Search, streaming, sync, shelves, and server browsing. |

## State Combination Matrix

| Stored session | Downloaded content | Active Library | Login required | AuthStatus | AccessMode | Expected route behavior |
| --- | --- | --- | --- | --- | --- | --- |
| No | No | No | No | `anonymous` | `firstRunSignInRequired` | Route to required Login. |
| No | Yes | No | No | `offlineOnly` | `firstRunSignInRequired` | Route to required Login; downloaded assets remain on disk but are not exposed. |
| Yes | No | No | No | `authenticated` | `serverSetup` | Resolve Libraries, then choose/activate a Library. |
| Yes | Yes | No | No | `authenticated` | `serverSetup` | Resolve Libraries, then choose/activate a Library. Downloads remain available. |
| Yes | Any | Yes | No | `authenticated` | `serverBrowsing` | Route to Home unless already on a known app route. |
| Remembered identity | Yes | Maybe | Yes | `offlineOnly` | `downloadedSessionOnly` | Allow remembered-session downloads; prompt for sign-in when needed. |
| Any | Any | Stale or invalid | No | `authenticated` | `serverSetup` after clearing invalid Active Library | Validate Libraries and require Library Selection if needed. |

## Startup Flow

1. `useAuthBootstrap` calls auth hydration.
2. `auth-store` reads credentials and tokens.
3. Download availability is provided by device state.
4. `AuthStatus` is computed.
5. `selectAccessMode` determines which app surfaces are available.
6. Root routing sends users with no usable or remembered User Session to Login, downloaded-session users to remembered downloaded surfaces, and authenticated users to known authenticated routes or Home.
7. `LibrarySelectionGate` validates the remembered Active Library against the Libraries returned by the Audiobookshelf Server.

## Library Resolution

After sign-in or when an authenticated User Session has no Active Library:

| Library count | Behavior |
| --- | --- |
| Zero | User Session remains valid, but server browsing is unavailable. |
| One | Library may be activated automatically. |
| Multiple | User must complete Library Selection. |

The app must not set a temporary Active Library before user choice when multiple Libraries exist.

## Library Activation Data

Library Activation requires:

- `queryKeys.libraryBooks(libraryId)`
- `queryKeys.userServerState(activeLibraryUserKey)`

Remembered activation data can satisfy activation immediately. Missing required data must be fetched before the Active Library is committed.

Non-blocking enhancement:

- `queryKeys.libraryPlaylists(activeLibraryUserKey, libraryId)`

Playlist data may prefetch in the background and must not block activation.

## Home Menu Library Switch

The Home menu is the preferred working adapter for user-requested Library Selection.

Current flow:

1. `HomeShelvesScreen` calls `activateLibrarySelection(library)`.
2. `runLibraryActivationSelection` starts Library Activation state.
3. The app routes to Home under the loading overlay.
4. Required activation data is loaded or read from cache.
5. Active Playback is ended and unloaded while the previous Active Library is still current.
6. `setActiveLibrary` commits the new Active Library.
7. Activation state clears.
8. Home shelves render using the new Active Library.

This flow should not be changed unless there is a true bug.

## Authentication Screen Library Switch

The Authentication screen opens `/library-picker` as a form sheet.

Required flow:

1. Authentication screen pushes `/library-picker`.
2. The Library bottom sheet displays available Libraries.
3. User taps a Library.
4. The tapped card immediately becomes visually selected and shows a centered spinner.
5. The bottom sheet dismisses.
6. The same Library Activation command used by the Home menu runs.
7. The app navigates to Home and shows the Library Activation loading state.
8. The new Active Library commits only after activation succeeds.

The picker route is a sheet adapter. It should not own Active Library commitment. It only captures Library Selection intent, provides immediate visual feedback, dismisses the sheet, and hands off to Library Activation.

## Failure Behavior

If activation fails:

- Previous Active Library remains committed when one exists.
- Retry attempts the same chosen Library again.
- Cancel clears activation state.
- If no previous Active Library exists, Cancel returns to Library Selection.

## Explicit Logout Boundary

Explicit logout is coordinated above the auth store. The logout command must snapshot Active
Playback's Listening Position for the current User Session, end Active Playback, clear the Current
Audiobook surface, clear server-derived query snapshots, clear auth credentials/session state, and
route to required Login. Durable device state such as Downloaded Audio Assets,
local bookmark records, and identity-scoped Progress Sync Intents survives logout.

## Important Modules

| Area | Module | Purpose |
| --- | --- | --- |
| Access Mode derivation | `selectAccessMode` | Converts AuthStatus and stored state into app surfaces. |
| Library Resolution | `src/auth/library-resolution.ts` | Determines no-library, one-library, or needs-selection outcome. |
| Library Activation command | `runLibraryActivationSelection` | Centralizes activation, routing, commit, and failure handling. |
| Library Selection UI adapter | `src/app/library-picker.tsx` | Presents choices and hands selected Library to activation. |
| Home menu adapter | `HomeShelvesScreen` | Uses the activation command directly from Home. |
| Activation overlay | `LibraryActivationOverlay` | Blocks interaction and displays activation progress/failure. |

## Invariants

- Do not commit a new Active Library before Library Activation succeeds.
- Do not let a half-loaded Home screen become interactive.
- Do not make playlist loading block Library Activation.
- Do not let the Authentication screen picker implement a separate Active Library change path.
- Do not change the Home menu adapter unless it has a confirmed bug.
