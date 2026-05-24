# Durable Progress Sync Intents Before Remote Sync

LAABS Audio writes a durable Progress Sync Intent before attempting remote sync for pause, user-initiated seek, stop, audiobook switching, natural completion, app backgrounding, and playback interruption. This chooses local Listening Position durability over a simpler network-first flow, so a process kill or suspended network request cannot lose the user's latest audiobook position. A successful remote sync clears only the matching or older Progress Sync Intent for that audiobook, preserving any newer local intent created while the sync was in flight.

## Consequences

- Pause, user-initiated seek, stop, audiobook switching, natural completion, backgrounding, and interruption flows may briefly create queue churn even when the device is online.
- Sync completion must compare intent ordering before clearing queued work.
- Streamed playback may switch from session sync to direct progress sync while a Progress Sync Intent exists.
