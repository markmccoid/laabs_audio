# Listening Position Sync

LAABS Audio keeps audiobook progress durable locally before it asks Audiobookshelf to accept that progress. The implementation is split so playback control stays in `PlayerService`, while progress intent, resume choice, and remote sync rules live in progress modules.

## Modules

- `src/progress/progress-sync-intents.ts` names Progress Sync Intent kinds and the triggers that create durable intent before remote sync.
- `src/progress/progress-sync-intent-store.ts` wraps the existing device-books pending progress storage. It records typed intents, remembers the last user scope for downloaded audiobooks, and clears only matching or older intents after confirmed sync.
- `src/progress/listening-position-sync.ts` decides whether a progress write uses streamed session sync, direct progress update, or local queued intent. Interval sync is opportunistic; pause, seek, stop, switch, background, interruption, and finish are durable moments.
- `src/progress/resume-resolution.ts` owns the candidate selection rule used when opening an audiobook.

## Rules

- Downloaded and streamed audiobooks share Resume Resolution and Progress Sync Intent rules.
- Streamed playback may use Audiobookshelf session sync only while there is no unresolved Progress Sync Intent.
- Downloaded playback uses direct progress update when online and authenticated.
- A successful remote sync clears only the Progress Sync Intent that was synced, or an older one for the same audiobook and user scope.
- A newer Progress Sync Intent created while a remote sync is in flight remains pending.
- Explicit finished and unread changes are authoritative user intent.
- Automatic zero-position samples must not erase meaningful Listening Position evidence.
- Downloaded-Only Mode may continue recording local Progress Sync Intent records under the last known user scope for that downloaded audiobook. They flush only when the same User Session is restored.
- A missing audiobook during flush becomes an Unmatched Progress Sync Intent rather than retrying forever.

## Current Storage Shape

The first implementation keeps the existing `pendingProgressByUser[userKey][libraryItemId]` storage shape and adds intent metadata to each pending entry. This preserves the one-pending-entry-per-audiobook behavior while enabling intent kind, identity scope, and stale-clear ordering.

If multiple pending intents per audiobook become necessary later, migrate `pendingProgressByUser` from a keyed latest-intent map to an ordered per-audiobook queue behind `progress-sync-intent-store.ts`.
