# Audiobookshelf User Identity Owns Local Listening State

LAABS Audio will use the Audiobookshelf user UUID as the durable identity for user-owned local state. Server URL is a Server Connection Endpoint used for API calls, and username remains display and Favorite metadata. Bookmarks, Clip Bookmarks, Home shelf state, playback rate, Listening Position, and Progress Sync Intents are scoped to the Audiobookshelf User Identity, not to `username::serverUrl`.

This supersedes ADR 0011's explicit post-logout playback restriction and ADR 0014's server-and-username remembered-session identity.

## Consequences

- A Remembered User Session is identified by Audiobookshelf User Identity.
- User Session entry fails when Audiobookshelf User Identity is unavailable.
- LAABS Audio treats Audiobookshelf User Identity collisions as outside the domain model.
- The same Audiobookshelf User Identity reached through a different Server Connection Endpoint is the same Remembered User Session.
- Multiple Session Entry Options may restore the same Remembered User Session through different Server Connection Endpoints.
- Session Entry Options are remembered only after Audiobookshelf User Identity is known.
- The successful Session Entry Option determines the current Server Connection Endpoint for API calls.
- Removing one Session Entry Option does not remove user-owned local state when other Session Entry Options restore the same Audiobookshelf User Identity.
- Server Connection Endpoint is retained for API calls and may change without forking local listening state.
- Username from the current successful Session Entry Option is retained for display and Favorite tag behavior.
- Explicit logout may enter Downloaded-Only Mode immediately when owned playable Downloaded Audio Assets exist.
- Explicit logout clears restoration tokens for all Session Entry Options belonging to the signed-out Audiobookshelf User Identity.
- Explicit logout clears saved credentials for all Session Entry Options belonging to the signed-out Audiobookshelf User Identity.
- A Session Entry Switch crosses a User Session boundary without clearing restoration material for the previous Audiobookshelf User Identity.
- A Session Entry Switch durably captures local listening changes for the previous Audiobookshelf User Identity and does not block on remote sync.
- Downloaded-Only Mode can show and change local Listening Position, Bookmark, Clip Bookmark, and Playback Rate state when the Downloaded Audio Asset Owner is known.
- Downloaded-Only Mode does not create a global signed-out user context; each downloaded audiobook experience carries its owner.
- Shared downloaded media may gain another owner only after a signed-in User Session can access the same Audiobook Identity.
- Progress Sync Intents sync through the current Server Connection Endpoint when the signed-in Audiobookshelf User Identity matches their owner.
- Old user-scoped local app state and legacy downloads from the previous identity model are discarded after a Local Data Reset Notice rather than migrated.
- Unrelated app preferences may survive the Local Data Reset Notice.
