# Authentication and Library Selection

This document describes what a user should experience when signing in, returning to the app, choosing a Library, and switching Libraries.

## Key Ideas

LAABS Audio connects to an Audiobookshelf Server. A signed-in user has a User Session. That User Session may have zero, one, or many Libraries.

Only one Library is active at a time. The Active Library is the Library used for Home, Search, shelves, and audiobook browsing.

Changing Libraries is a visible transition:

1. The user chooses a Library.
2. The app shows immediate feedback that the Library was chosen.
3. The app prepares the Library for browsing.
4. Home opens with a blocking loading state until the chosen Library is ready.

## App States

| User state | What the user can do |
| --- | --- |
| App is restoring saved state | Wait for startup to finish. |
| No sign-in and no downloads | Sign in before using the app. |
| No sign-in, but downloads exist | Listen to downloaded audiobooks and sign in when needed. |
| Previous session needs sign-in, but downloads exist | Keep using session downloads and sign in again before server browsing. |
| Signed in, no Library selected | Choose a Library before Home, Search, and server browsing work. |
| Signed in with an Active Library | Use Home, Search, streaming, sync, shelves, and server browsing. |
| Library is loading | Wait on the blocking loading state; browsing controls stay unavailable until loading finishes. |
| Library loading failed | Retry the selected Library or cancel back to the previous safe state. |

## First Sign-In

When the user signs in for the first time:

- If the Audiobookshelf Server returns no Libraries, the app explains that no Libraries are available.
- If the server returns one Library, the app can choose it automatically.
- If the server returns multiple Libraries, the app asks the user to choose one.

The user should not see normal server browsing until a Library has been chosen and prepared.

## Returning to the App

When the app starts:

- If the user has a remembered User Session and Active Library, the app opens into normal server browsing.
- If the user has a remembered User Session but no Active Library, the app asks them to choose a Library.
- If the user is not signed in but has downloaded audiobooks, the app still opens downloaded content.
- If there is no User Session and no downloaded content, the app requires sign-in.

## Switching Libraries from Home

From Home, the user can open the menu and choose another Library.

Expected flow:

1. The user chooses a Library from the Home menu.
2. The app shows a blocking loading screen.
3. The previous Library remains valid until the new Library is ready.
4. The new Library becomes active.
5. Home shows the new Library.

## Switching Libraries from Authentication Settings

From Settings, the user can open Authentication and choose Change Library.

Expected flow:

1. The Library bottom sheet is shown.
2. The user taps a Library.
3. The tapped Library card immediately turns active and shows a spinner.
4. The bottom sheet closes.
5. The app navigates to Home.
6. Home shows the same loading state used by Home menu Library switching.
7. The new Library becomes active only after it is ready.

## If Loading Fails

If the chosen Library cannot be prepared:

- Retry attempts to load the same chosen Library again.
- Cancel keeps the previous Active Library if one exists.
- If no previous Active Library exists, Cancel returns to Library Selection.

The app should not leave the user on a half-loaded Home screen.

## Downloaded Content

Downloaded audiobooks remain available even when the user is not fully signed in. In downloaded-only experiences, server browsing, Library Selection, search, streaming, and sync are not available until the User Session is restored.
