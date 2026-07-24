# Episode Detail stack presentation and phone tap model

**Status:** accepted (amends ADR 0027 presentation/tap rules)

Phone Episode presentations open **Episode Detail** — a full-screen stack surface keyed by Episode Identity, BookContainer-shaped but a parallel container (not BookContainer, not a Current Episode browse context). Primary tap on Current Podcast episode rows and Home Continue / Recent / Downloaded episode tiles pushes Episode Detail; Playback Start Attempt starts from Episode Detail Play or from a long-press **Episode Action Set** (Play/Pause, Download/Remove Download, Open Podcast — Open Podcast omitted/disabled when already on that show). CarPlay keeps tap-to-play. Retire the Episode Detail formSheet and the Current Podcast info / trailing-play row chrome. Offline Episode Detail shows known metadata and plays when a local Downloaded Audio Asset exists; it does not invent missing description.

## Consequences

- ADR 0027 still governs Current Podcast episode list source, Podcast Episode Order, reverse toggle, and in-memory title filter; its “primary tap plays / info opens Episode Detail Sheet” rule is superseded here.
- Episode Action Sets are parallel to Book Action Sets and must not reuse book action IDs or BookContainer.
- Parent Podcast `libraryItemId` routes remain Current Podcast only.
