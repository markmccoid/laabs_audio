# Podcast Home Shelf Display assembly

> The fixed-composition portion of this decision is superseded by ADR-0033. The four built-in shelf sources and their derived ordering remain in force.

When the Active Library is a podcast Library, Home Shelf Display shows four shelves, in order: **Continue Listening** (Episodes from Touched Episode effective progress, newest progress update first), **Recent Episodes** (ABS `recent-episodes` first page, with a last-successful snapshot for offline/failure), **Podcasts** (Podcast Series Index ordered by `addedAt` descending), and **Downloaded** (locally downloaded Episodes for offline listening). Book-oriented Home shelves (Discover, custom shelves, playlist shelves, book Downloaded as audiobook rows) are omitted. Continue and Recent may overlap; runtime Active Playback / Displayed Listening Position overlays apply after durable assembly. Podcast Home uses a parallel assembly path — not an extension of the book Home SQLite/home-shelf modules.

## Consequences

- Recent Episodes is never an Activation gate; it may load or show a stale snapshot after Home is browsable (ADR 0025).
- Downloaded Episodes are a first-class Home shelf so offline listening does not depend only on Continue Listening (ADR 0029).
- Pull-to-refresh refreshes Recent (+ snapshot), Touched overlay import from that response, and a stale Podcast Series Index — not the book catalog path. Downloaded shelf reads local download records.
