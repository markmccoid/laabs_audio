# Remembered User Sessions for Sign-In Switching

LAABS Audio stores multiple Remembered User Sessions so users can restore or switch between sign-ins without re-entering server and username details. Remembered entries are keyed by the User Session identity, not by Audiobookshelf Server alone, because listening state, downloads, credentials, tokens, and Active Library memory are scoped to a specific server and username pair.

## Consequences

- A Remembered User Session is identified by Audiobookshelf Server and username; submitting the same pair updates the existing entry instead of creating a duplicate.
- Switching from one signed-in User Session to another crosses the same User Session boundary as explicit logout before the next Session Restoration starts.
- Session Restoration may use remembered tokens first and remembered credentials as a fallback.
- Removing a Remembered User Session forgets restoration material for that entry but does not delete durable listening data or Downloaded Audio Assets scoped to that User Session.
- The sign-in entry list uses Session Labels for user-facing names while preserving server and username as the durable identity.
- Legacy single-session credentials and tokens are migrated into one Remembered User Session and then cleared from legacy keys after the new entry and active pointer are written successfully.
- Auth migration must stay idempotent and small so successful startup does not repeatedly pay migration cost.
