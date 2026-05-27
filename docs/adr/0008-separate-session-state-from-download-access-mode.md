# Separate Session State From Download Access Mode

LAABS Audio separates Session State from Access Mode so app entry is not controlled by auth status alone. Forced sign-in is only for first run with no User Session and no Downloaded Audio Assets; downloaded-capable modes may dismiss sign-in and continue playing local audio. Downloaded Audio Assets are separate from Download Entitlements so explicit logout can show all device downloads without sync, while a signed-in User Session sees only its entitled downloads and syncs only its own queued state.

## Consequences

- Root navigation guards route from Access Mode rather than raw auth status.
- Session Needs Sign-In keeps remembered User Session identity for entitled downloads and queued sync, but blocks streaming, search, server browsing, and sync until sign-in succeeds.
- Downloaded-Only Mode has no signed-in User Session and performs no sync activity.
- A Downloaded Audio Asset may be shared by multiple User Sessions through separate Download Entitlements without duplicating local files.
- Legacy Downloaded Audio Assets without server identity remain available in Downloaded-Only Mode until they can be associated with a User Session.
