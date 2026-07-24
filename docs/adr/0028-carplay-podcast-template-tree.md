# CarPlay podcast template tree

When the Active Library is a podcast Library, CarPlay keeps the same single-root shell as books (one root `CPListTemplate`, no second root). Root shelves mirror podcast Home: **Continue Listening**, **Recent Episodes**, and **Downloaded** as playable Episode rows, plus **Podcasts** as a non-playable series list (order: Continue → Recent → Podcasts → Downloaded). Opening a Podcast pushes an episode list loaded like phone Current Podcast (live expanded item, **Podcast Episode Order**, play by Episode Identity). Now Playing shows Episode title with Podcast as artist/subtitle, keeps the rate control, and **disables Up Next / Chapters** for Episode playback — show episodes are not overloaded into Up Next. Remote Command Mode skip intervals still apply; chapter next/prev remain no-ops without chapter data.

## Consequences

- Podcast CarPlay publishing is a parallel data path into the existing native template tree, not a second CarPlay app root.
- Offline/degraded: Continue from Touched Episode rows, Recent from last snapshot, Podcasts from the series index; show episode drill-in needs expanded cache or shows unavailable.
- CarPlay list caps may truncate long episode lists; full browse remains on phone.
