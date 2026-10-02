---
status: accepted
---

# PDF Read-Along follows physical pages

PDF Read-Along is an iOS Readium surface alongside Transcript and EPUB, driven by LAABS Align's version 1 PDF Page Map. Unlike an EPUB Alignment Map, the PDF Page Map addresses fixed physical pages and requires the opened document's SHA-256 and actual page count to match before any synchronization. This preserves graphs and publisher layout while keeping the schedule small and avoiding continuous word decoration work; the user confirmed this scope on 2026-10-01.

Manual PDF browsing suspends Follow Mode and leaves the Listening Position unchanged, consistent with Transcript and EPUB. Resume following returns to the page currently being narrated without seeking audio. An explicit Listen from page action seeks a timed page to its start, resumes following, and preserves paused/playing state. Navigator-issued turns must never seek in response to their own callbacks.

Refined on 2026-10-01 after device use exposed accidental seeks while scrolling: this supersedes the initial behavior where every timed page turn sought audio. PDF page seeks and EPUB text taps now offer a 10-second Go back toast that restores the pre-seek Listening Position and resumes following. Each new document seek replaces the prior undo; untimed pages have no Listen action.

The map and PDF are durable library assets, independent of audio downloads. A separate shadow-SQLite table stores the original contract JSON by audiobook and PDF identity; the schedule is small enough to parse on open, and current track metadata determines rebasing without rewriting producer timings. Strict document mismatches, degraded maps, or incompatible audio tracks leave the PDF readable with synchronization disabled. Untimed pages remain browsable; matched and interpolated pages participate in following. Word highlighting and Android support remain outside this version.

The producer contract remains authoritative: `LAABS Audio Align/docs/contracts/pdf-page-alignment.md`. See [implementation details](../pdf-read-along.md).


Extended on 2026-10-01 at the user's request: an optional PDF Paragraph Map can select one translucent margin-wide paragraph box during audio playback. Paragraph selection has its own start/end boundary schedule and clears untimed gaps. It never navigates or seeks; the PDF Page Map remains the navigation authority. The paragraph file inherits its referenced page map's audio-track manifest and must match that map's alignment ID plus the opened PDF's hash/count. Sidecar loading, caching, parsing and track rebasing fail independently so page following remains available. The user changed the rendering requirement from per-line rectangles to one box; line Y extents determine height and crop-box margins determine width. Word highlighting remains outside scope.
