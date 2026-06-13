# Single User Session Entry Module Crosses the Boundary After Identity Is Confirmed

User Session Entry — establishing the signed-in User Session from either Session
Restoration or credential submission — is owned by one module, `enterUserSession`,
instead of being choreographed by each sign-in surface. The module confirms the
Audiobookshelf User Identity over the network first, persists the new Remembered User
Session as inactive, crosses the User Session boundary (durably capturing the previous
identity's listening state, then tearing down only live runtime state), and finally
makes the new session active as a single step. It returns a Session Entry Resolution;
navigation and Library Activation stay with the caller.

This refines ADR-0015's Session Entry Switch consequences: the boundary is crossed only
after the new identity is confirmed, so a failed or interrupted entry leaves the previous
User Session intact. It replaces the per-surface choreography in which the boundary rule
was passed into the store as a `beforeCommit` callback by the caller.

## Consequences

- The Sign-In list, edit, and form surfaces call one `enterUserSession({ via })` function
  instead of replicating prepareForSignInChange → restore/login → completeSessionEntry.
- A failed authenticate step leaves the previous User Session fully intact; no live state
  is torn down before the new Audiobookshelf User Identity is confirmed.
- The new Remembered User Session is persisted before the previous session's live state is
  torn down; making the new session active is the last step.
- The same-identity vs different-identity teardown rule lives behind one interface, not in
  a `beforeCommit` callback supplied by the caller.
- `enterUserSession` is navigation-free and returns a Session Entry Resolution — activate a
  resolved Active Library, present Library Selection, no available Libraries, or failed with
  a reason kind. Callers map the resolution to routes and run the shared Library Activation
  (ADR-0009).
- The auth store exposes smaller session-commit primitives; authenticate, boundary crossing,
  and commit are separately exercisable, so the Session Entry Switch is testable without UI.
- One in-flight guard in the module replaces the per-surface guards (`pendingSessionKey`,
  `isSubmitting`, `isLoggingOutRef`) for entry.
- Durable identity-scoped data (Bookmarks, Progress Sync Intents, Downloaded Audio Assets)
  is never torn down by entry; crossing clears only live runtime state — Active Playback,
  the session query cache, and Library Activation.
</content>
</invoke>
