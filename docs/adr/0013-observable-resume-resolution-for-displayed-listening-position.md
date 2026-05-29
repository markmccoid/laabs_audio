# Observable Resume Resolution for Displayed Listening Position

LAABS Audio will expose the chosen Resume Resolution to progress display code and use it as the first trusted Displayed Listening Position while opening an audiobook. This chooses a shared display contract over letting the main slider, Book detail, and Home independently infer progress from React Query cache, raw playback engine position, and queued Progress Sync Intents.

**Consequences**

- Player and browsing surfaces should read one Displayed Listening Position for Active Playback.
- Temporary playback engine positions, such as setup zero or stale early native status, must not move display progress away from the chosen Resume Resolution.
- Fresh server progress may advance the Displayed Listening Position during startup handoff, but must not move it backward or override newer local listening evidence.
- User-initiated Listening Position changes, including slider scrubbing, skip controls, chapter navigation, and Play from Bookmark, should update Displayed Listening Position optimistically and roll back to the last trusted position if the change fails.
- Displayed Listening Position is derived state and should not become a separate durable progress source.
- During a Playback Start Attempt, player surfaces may show the attempted audiobook's Displayed Listening Position before it becomes Active Playback, while browsing surfaces keep using Active Playback for live display progress until ownership is confirmed.
