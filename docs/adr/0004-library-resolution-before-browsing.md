# Library Resolution Happens Before Browsing

LAABS Audio treats Library Resolution as part of User Session entry before the session becomes browsable. A User Session with exactly one Library may make that Library the Active Library automatically, but a User Session with multiple Libraries must not set a temporary Active Library before the user completes Library Selection; this avoids wrong-library warmup, stale home data, and hidden state churn after login.

## Consequences

- First-time login does not finish into the normal home experience until Library Resolution succeeds.
- A zero-Library User Session is authenticated but not browsable.
- Library Selection chooses the Active Library first; Library-scoped books, shelves, progress, and playlist data load afterward.
- Setup Library Selection should show an explicit loading state while the first Active Library data is prepared.
- A remembered Active Library may be trusted for the same User Session at startup, but it must be cleared if Audiobookshelf no longer returns that Library.
