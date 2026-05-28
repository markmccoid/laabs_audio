# Separate Session State From Download Access Mode

Status: Superseded by ADR 0011 for explicit post-logout downloaded access and Download Entitlement language.

LAABS Audio separates Session State from Access Mode so app entry is not controlled by auth status alone.

Historical decision: forced sign-in was only for first run with no User Session and no Downloaded Audio Assets; downloaded-capable modes could dismiss sign-in and continue playing local audio.

Current rule: explicit signed-out state requires sign-in before downloaded playback. Downloaded Audio Assets are device assets, while Download Availability is established by a signed-in or remembered User Session that can access the same Audiobook Identity.

## Consequences

- Root navigation guards route from Access Mode rather than raw auth status.
- Session Needs Sign-In keeps remembered User Session identity for downloaded access and queued sync, but blocks streaming, search, server browsing, and sync until sign-in succeeds.
- Downloaded-Only Mode is deprecated and must not be used as explicit post-logout access.
- A Downloaded Audio Asset may be shared by multiple User Sessions through Download Availability without duplicating local files.
- Legacy Downloaded Audio Assets without server identity remain on disk but are not visible or playable until a User Session can associate them with an accessible Audiobook Identity.
