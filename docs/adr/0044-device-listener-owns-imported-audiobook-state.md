---
status: accepted
---

# The Device Listener owns Imported Audiobook listening state

Imported Audiobooks (audio the user brings in from iCloud Drive or on-device storage) have no Audiobookshelf Server, so they cannot use an Audiobookshelf User Identity as their Listening State Owner the way ADR-0015 requires for everything else. We decided that one device-wide **Device Listener** owns all Imported Audiobook listening state (Listening Position, Bookmarks, Clip Bookmarks, Playback Rate, Listening Interruption). That state is the same under every User Session and with no User Session at all, and it never syncs to any Audiobookshelf Server. The user confirmed this on 2026-10-10.

This narrows ADR-0015 rather than reversing it: Audiobookshelf audiobooks and Episodes are still owned by an Audiobookshelf User Identity.

## Considered Options

- Per-Audiobookshelf-identity state for imported books, plus a no-account owner. Rejected because switching between your own two ABS accounts would split progress for a file that has nothing to do with either server.
- A local "Listener" profile created even without ABS. Rejected as a second identity system with no user-visible benefit.

## Consequences

- LAABS Audio can be used with no User Session ever (Imported-Only Mode). Imported Audiobooks never depend on Download Availability.
- Removing an Imported Audiobook keeps its Device Listener state by default, so re-importing the same audio restores Bookmarks and Listening Position. The removal flow offers an explicit option to also delete that state.
- Crossing a User Session boundary still tears down Active Playback (ADR-0021) even when an Imported Audiobook is playing. Its state survives because it does not belong to either identity. Exempting it is a possible later refinement.
