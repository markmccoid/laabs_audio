# Explicit Logout Requires Sign-In Before Playback

Status: Superseded by ADR 0015 for explicit post-logout downloaded access.

Explicit logout requires sign-in before any audiobook browsing or playback, even when Downloaded Audio Assets remain on the device. Downloaded Audio Assets are durable local media, but they become usable only through Download Availability for a signed-in or remembered User Session that can access the same Audiobook Identity; listening state such as Listening Position, Bookmarks, and Playback Rate remains scoped to that User Session.

## Consequences

- Explicit logout enters Signed-Out Required Sign-In rather than Downloaded-Only Mode.
- Downloaded Audio Assets are not deleted by logout, but they are hidden and unplayable until a User Session is available.
- Session Needs Sign-In may still expose remembered downloaded content because the User Session owner is known.
- A signed-in User Session may reuse a local Downloaded Audio Asset when it can access the same Audiobook Identity on the Audiobookshelf Server.
- This supersedes ADR 0006's post-logout playback rule, ADR 0008's Downloaded-Only Mode access rule, and ADR 0010's Downloaded-Only Mode cache-display consequence.
