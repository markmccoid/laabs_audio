# Library Activation Before Active Library Commit

LAABS Audio delays committing a user-requested Active Library change until Library Activation has enough catalog data and User Session listening state to make the chosen Library browsable. This rejects optimistic Active Library changes because they can expose blank Home screens, stale old-library content, and interactions against a half-ready browsing scope when a large Library takes time to load.

## Consequences

- Library Selection records user intent, but the previous Active Library remains browsable until the chosen Library activates successfully.
- Library Activation is coordinated globally and blocks app interactions while it is in progress.
- Remembered activation data may satisfy Library Activation immediately; missing activation data must be fetched before the Active Library is committed.
- User-requested Library Activation routes to Home after success because Home is the safe browsing surface for a changed Library scope.
- If activation fails, Retry attempts the same chosen Library again and Cancel leaves the previous Active Library unchanged; when no previous Active Library exists, Cancel returns to Library Selection.
- Library-scoped enhancements that are not required for coherent browsing may load after activation.
