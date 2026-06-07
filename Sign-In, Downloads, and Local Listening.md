Below is user-facing copy you can adapt for docs/help text.

---

## Sign-In, Downloads, and Local Listening

LAABS Audio is built around your Audiobookshelf account. When you sign in, the app connects to a specific Audiobookshelf server as a specific user. That signed-in user controls what library content, progress, bookmarks, downloads, and saved listening state the app is allowed to show.

A downloaded audiobook is stored on your device, but it is still linked to the Audiobookshelf user who downloaded it. This matters because multiple people, or the same person using different servers, may use the app on one device. LAABS Audio tries to keep each user’s local listening data separated so one user does not see another user’s downloads, bookmarks, or progress.

### When You Are Signed In

When you are signed in, the app shows downloaded books that belong to the signed-in Audiobookshelf user. If User A downloaded a book, then User B signs in, User B should not see User A’s downloaded book in the normal downloaded-books view.

This is intentional. The file may still be physically on the device, but the app treats it as User A’s local content. User B only sees downloads and listening state tied to User B.

While signed in, you can:

- browse your Audiobookshelf libraries
- stream books from the server
- play your own downloaded books
- sync progress and bookmarks with the server
- download more books for offline use

If you switch from one saved sign-in to another sign-in for the same Audiobookshelf user, the app treats that as the same user identity. This can happen when the same server is reachable from two different addresses, such as an external URL and an internal home-network URL. In that case, downloaded playback may continue because the user has not changed.

Streamed playback is more sensitive. If the active book is streaming and you change sign-ins, the app closes the streamed book. This avoids using an old streaming session, token, or server address after the sign-in changes.

### When You Are Fully Signed Out

When you are fully signed out, the app is no longer connected to an Audiobookshelf user session. In this state, server browsing, streaming, library search, sync, and account-specific server features are unavailable.

Downloaded files may still exist on the device, but what you can see depends on whether the app still has enough remembered user context to safely identify those downloads.

If the app knows which previous user a download belongs to, it can show downloaded-only access for that remembered user context. This lets you keep listening offline without pretending you are fully signed in.

If there is no usable remembered user context, the app should require sign-in before showing user-scoped content. This prevents downloaded books from one account being exposed while no user identity is active.

### What Happens When You Switch Sign-Ins

The app compares the current user identity with the target sign-in.

If the user id is different, the app closes the active book. This prevents User A’s downloaded or streamed book from continuing after User B signs in.

If the user id is the same, the app treats it as the same Audiobookshelf user. Downloaded playback may continue. This supports the common case where the same server is accessed through different URLs.

If a streamed book is active, the app closes it on sign-in changes even when the user is the same. This gives the new server URL and token a clean start.

## Saved Sign-Ins

LAABS Audio can remember sign-ins so you can switch between them later. A saved sign-in represents a username, server URL, Audiobookshelf user id, display label, and selected library information.

The app may also store credentials or tokens securely so it can reconnect without asking for your password every time. These secrets are stored separately from normal app data.

A saved sign-in can include:

- server URL
- username
- Audiobookshelf user id
- sign-in label
- last selected library
- access and refresh tokens
- password, if saved for reconnecting

Downloaded audio files, local cover images, local bookmarks, local notes, playback rates, and pending progress sync data can remain on the device after signing out. They are scoped to the relevant user where possible.

### What Is Cleared on Sign-Out

When you sign out, the app clears the active session credentials and active library state. Server-derived cached data is cleared so the next user does not see the previous user’s library or account data.

Downloaded files are not deleted just because you sign out. Local listening data also remains unless you explicitly remove downloads or app data.

Signing out generally clears:

- active access token
- refresh token
- stored active session state
- active library selection
- server browsing cache for the signed-in session

Signing out does not automatically delete:

- downloaded audiobook files
- downloaded cover images
- local bookmark metadata
- local listening progress records
- queued progress waiting to sync
- saved sign-in entries, unless you remove them

### Removing a Saved Sign-In

Removing a saved sign-in removes that saved account entry from the app. Downloaded audio and local listening data may still remain on the device unless you delete those downloads separately.

This separation is deliberate: signing out or removing a sign-in should not unexpectedly delete large downloaded audiobook files. Deleting downloads is a separate action.