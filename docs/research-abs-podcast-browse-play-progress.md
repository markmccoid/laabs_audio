# Research: ABS APIs for podcast browse, play, and progress

**Ticket:** [#7 — Confirm ABS APIs for podcast browse, play, and progress](https://github.com/markmccoid/laabs_audio/issues/7)  
**Map:** [#5 — Podcast architecture handoff](https://github.com/markmccoid/laabs_audio/issues/5)  
**Primary source:** [Audiobookshelf API](https://api.audiobookshelf.org) (official OpenAPI-style docs)  
**Date:** 2026-07-23  
**Scope:** Document endpoints and response shapes LAABS needs. No app implementation.

All claims below cite https://api.audiobookshelf.org unless noted. Section titles in citations match that site’s headings.

---

## Mental model (ABS)

In Audiobookshelf, a **podcast Library** has `mediaType: "podcast"`. Each **show** is a **Library Item** with `mediaType: "podcast"`; its `media` is a **Podcast** object. **Episodes** live under `media.episodes` (or as standalone Podcast Episode objects on recent-episode / progress paths). Progress for an episode is keyed by `(libraryItemId, episodeId)`; progress IDs are `libraryItemId-episodeId`.

---

## 1. Listing podcasts (shows) in a podcast Library

### Endpoint

`GET /api/libraries/<libraryId>/items`

Optional query (pagination / minify):

| Param | Role |
| --- | --- |
| `limit` | Page size; `0` = no limit |
| `page` | 0-indexed page (ignored if no limit) |
| `sort` | JS-object-notation attribute, e.g. `media.metadata.title` |
| `desc` | `0` / `1` |
| `filter` | See Filtering on the API docs |
| `minified` | `0` / `1` — prefer `1` for a thin series/show index |
| `collapseseries` | Book-oriented collapse; not needed for podcast Libraries |
| `include` | e.g. `rssfeed` |

**Source:** [Get a Library's Items](https://api.audiobookshelf.org/#get-a-library-s-items)

### Response shape

Top-level:

| Field | Type | Notes |
| --- | --- | --- |
| `results` | Library Item[] or Library Item Minified[] | When `minified=1` |
| `total` | Integer | Total results |
| `limit`, `page` | Integer | Echo request |
| `sortBy`, `sortDesc`, `filterBy` | optional | Echo request |
| `mediaType` | `"book"` \| `"podcast"` | Library media type |
| `minified`, `collapseseries`, `include` | | Echo request |

For podcasts, each result’s `media` is a **Podcast** / **Podcast Minified**:

- **Full Podcast:** includes `episodes` (array of Podcast Episode), metadata, tags, auto-download fields.  
- **Podcast Minified** (what `minified=1` yields inside Library Item Minified): **removes** `libraryItemId` and **`episodes`**; **adds** `numEpisodes`, `size`; metadata is Podcast Metadata Minified (includes `titleIgnorePrefix`).

**Sources:** [Get a Library's Items](https://api.audiobookshelf.org/#get-a-library-s-items); schemas [Library Item](https://api.audiobookshelf.org/#library-item), [Podcast](https://api.audiobookshelf.org/#podcast) / Podcast Minified.

### LAABS takeaway

Use **`GET .../items?minified=1&limit=&page=`** for the podcast series/show index. Minified responses intentionally omit episode lists (`numEpisodes` only) — aligned with “thin series index + live ABS for episode discovery.”

Optional Home shelf for recently added shows: `GET /api/libraries/<id>/personalized` can return shelves with `type: "podcast"` and `entities` as Library Item Minified. **Source:** [Get a Library's Personalized View](https://api.audiobookshelf.org/#get-a-library-s-personalized-view) (Shelf `type` / entities).

---

## 2. Recent episodes across a Library

### Endpoint

`GET /api/libraries/<libraryId>/recent-episodes`

| Query | Role |
| --- | --- |
| `limit` | Page size; `0` = no limit |
| `page` | 0-indexed |

**Source:** [Get a Library's Recent Episodes](https://api.audiobookshelf.org/#get-a-library-s-recent-episodes)

### Behavior (documented)

Returns the library’s **newest unfinished** podcast episodes, sorted by episode publish time.

### Response shape

| Field | Type | Notes |
| --- | --- | --- |
| `episodes` | Podcast Episode Expanded[] | Each episode **also** has `podcast`: Podcast Minified |
| `total` | Integer | Documented as total podcast episodes in the library |
| `limit`, `page` | Integer | Echo request |

Podcast Episode Expanded adds `audioTrack`, `duration`, `size` vs base Podcast Episode (`id`, `libraryItemId`, `title`, `publishedAt`, `audioFile`, enclosure, etc.).

**Sources:** same endpoint; schemas [Podcast Episode](https://api.audiobookshelf.org/#podcast-episode) / Expanded; [Podcast Minified](https://api.audiobookshelf.org/#podcast).

### Related (Continue Listening)

Personalized shelves with `type: "episode"` and shelf ids `continue-listening`, `listen-again`, or `episodes-recently-added` attach `recentEpisode` (Podcast Episode) on Library Item Minified entities. Continue Listening also adds `progressLastUpdate`.

**Source:** [Get a Library's Personalized View](https://api.audiobookshelf.org/#get-a-library-s-personalized-view) — Shelf Entities notes for `type: episode` / `continue-listening` / `listen-again`.

Also: `GET /api/me/items-in-progress` returns in-progress Library Item Minified; podcast items include `recentEpisode`. **Source:** [Get Library Items In Progress](https://api.audiobookshelf.org/#get-library-items-in-progress).

---

## 3. Episodes for one podcast (show detail)

### Primary endpoint

`GET /api/items/<libraryItemId>`

| Query | Role for podcasts |
| --- | --- |
| `expanded=1` | Library Item Expanded; podcast `media` becomes Podcast Expanded (`episodes` as Podcast Episode Expanded[]) |
| `include=progress` | Needs `expanded=1`; adds `userMediaProgress` |
| `episode=<episodeId>` | Required when requesting progress for a **specific** podcast episode |
| `include=downloads` | Podcast download queue as `episodesDownloading` |
| `include=rssfeed` | Open RSS feed minified or null |

**Source:** [Get a Library Item](https://api.audiobookshelf.org/#get-a-library-item)

Without minify/expanded nuances: base Podcast already has `episodes: Podcast Episode[]`. Expanded upgrades episodes and adds `size`.

**Source:** [Podcast](https://api.audiobookshelf.org/#podcast) / Podcast Expanded.

### Single episode

`GET /api/podcasts/<libraryItemId>/episode/<episodeId>` → Podcast Episode.

**Source:** [Get a Podcast Episode](https://api.audiobookshelf.org/#get-a-podcast-episode)

### LAABS takeaway

Show detail = fetch the library item (prefer `expanded=1`) and read `media.episodes`. Client-side filter of that list covers in-show episode search (out of scope for iTunes / RSS search endpoints below).

---

## 4. Starting playback for an episode

### Endpoint

- Book / whole item: `POST /api/items/<libraryItemId>/play`
- **Episode:** `POST /api/items/<libraryItemId>/play/<episodeId>`

Body (optional but typical):

| Field | Notes |
| --- | --- |
| `deviceInfo` | `deviceId`, `clientName`, `clientVersion`, etc. |
| `forceDirectPlay` / `forceTranscode` | booleans |
| `supportedMimeTypes` | string[]; missing MIME → server may transcode |
| `mediaPlayer` | string, default `"unknown"` |

**Source:** [Play a Library Item or Podcast Episode](https://api.audiobookshelf.org/#play-a-library-item-or-podcast-episode)

### Response

**Playback Session Expanded**, including for podcasts:

| Field | Episode relevance |
| --- | --- |
| `id` | Session id (`play_…`) |
| `libraryItemId`, `episodeId` | Episode keyed |
| `mediaType` | `"podcast"` |
| `displayTitle` / `displayAuthor` | Episode title / podcast author in examples |
| `duration`, `startTime`, `currentTime` | Seconds |
| `audioTracks` | Track(s) with `contentUrl` for streaming |
| `libraryItem` | Library Item Expanded (includes podcast + episodes in examples) |
| `mediaMetadata` | Podcast Metadata |

**Sources:** same Play endpoint; schema [Playback Session](https://api.audiobookshelf.org/#playback-session) / Expanded.

### Session progress while playing

| Endpoint | Role |
| --- | --- |
| `POST /api/session/<sessionId>/sync` | Body: `currentTime`, `timeListened`, `duration` |
| `POST /api/session/<sessionId>/close` | Optional same sync fields |

**Sources:** [Sync an Open Session](https://api.audiobookshelf.org/#sync-an-open-session); [Close an Open Session](https://api.audiobookshelf.org/#close-an-open-session)

---

## 5. Progress sync for episodes

Episode progress uses the same Media Progress model as books, with non-null `episodeId`. Progress `id` for episodes is `` `${libraryItemId}-${episodeId}` ``.

**Source:** [Media Progress](https://api.audiobookshelf.org/#media-progress)

### CRUD / sync endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/me/progress/<libraryItemId>/<episodeId>` | Fetch episode progress |
| `GET` | `/api/me/progress/<libraryItemId>` | Book (no episode) |
| `PATCH` | `/api/me/progress/<libraryItemId>/<episodeId>` | Create/update; body: `duration`, `progress`, `currentTime`, `isFinished`, `hideFromContinueListening`, `finishedAt`, `startedAt` |
| `PATCH` | `/api/me/progress/batch/update` | Array of progress objects including optional `episodeId` |
| `DELETE` | `/api/me/progress/<progressId>` | e.g. `li_…-ep_…` |
| `GET` | `/api/me/progress/<progressId>/remove-from-continue-listening` | Sets `hideFromContinueListening` |
| `POST` | `/api/me/sync-local-progress` | Mobile local↔server merge by `lastUpdate`; examples use episode progress |

**Sources:** [Get a Media Progress](https://api.audiobookshelf.org/#get-a-media-progress); [Create/Update Media Progress](https://api.audiobookshelf.org/#create-update-media-progress); [Batch Create/Update Media Progress](https://api.audiobookshelf.org/#batch-create-update-media-progress); [Remove a Media Progress](https://api.audiobookshelf.org/#remove-a-media-progress); [Remove an Item From Continue Listening](https://api.audiobookshelf.org/#remove-an-item-from-continue-listening); [Sync Local Media Progress](https://api.audiobookshelf.org/#sync-local-media-progress)

### Media Progress shape (episode)

| Field | Type |
| --- | --- |
| `id` | `libraryItemId-episodeId` |
| `libraryItemId` | string |
| `episodeId` | string (null for books) |
| `duration` | float (seconds) |
| `progress` | float (0–1; `1` if finished) |
| `currentTime` | float (seconds) |
| `isFinished` | boolean |
| `hideFromContinueListening` | boolean |
| `lastUpdate`, `startedAt` | ms epoch |
| `finishedAt` | ms epoch or null |

Optional “with media” variant adds `media` and `episode`.

**Source:** [Media Progress](https://api.audiobookshelf.org/#media-progress)

### Via item fetch

`GET /api/items/<id>?expanded=1&include=progress&episode=<episodeId>` may include `userMediaProgress`.

**Source:** [Get a Library Item](https://api.audiobookshelf.org/#get-a-library-item) — Extra Attributes.

### LAABS takeaway

Episode progress sync is first-class and parallel to books: use **session sync** while an open play session exists; use **`PATCH /api/me/progress/.../...`** (or batch / sync-local-progress) for durable position without / after a session — same pattern as existing audiobook progress work, with `episodeId` added to identity.

---

## 6. Library search — does it return podcasts?

### Endpoint

`GET /api/libraries/<libraryId>/search?q=<query>&limit=<n>`

Default `limit` is `12`.

**Source:** [Search a Library](https://api.audiobookshelf.org/#search-a-library)

### Documented response schema

| Attribute | Type | Notes |
| --- | --- | --- |
| **`book` or `podcast`** | Array of **Library Item Search Result** | Key is **`book` or `podcast` depending on the library’s media type** |
| `tags` | string[] | |
| `authors` | Author Expanded[] | |
| `series` | Series Books[] | |

#### Library Item Search Result

| Field | Type |
| --- | --- |
| `libraryItem` | **Library Item Expanded** |
| `matchKey` | string or null — field that matched |
| `matchText` | string or null — matched text |

**Source:** [Search a Library](https://api.audiobookshelf.org/#search-a-library) — Response Schema / Library Item Search Result.

### Documented vs needs live probe

| Claim | Status |
| --- | --- |
| Podcast Libraries return hits under a top-level **`podcast`** key (not `book`) | **Documented** |
| Each hit is `{ libraryItem, matchKey, matchText }` with Expanded library item | **Documented** |
| Exact `matchKey` values used for podcast fields (title, author, tags, …) | **Not enumerated** for podcasts in docs (book example uses `"authors"`) — **live probe** if LAABS depends on match highlighting |
| Whether `authors` / `series` arrays are always empty for podcast Libraries | **Not stated** — example response is book-only; **probe** if UI assumes emptiness |
| Whether `libraryItem.media.episodes` in search hits is the **full** episode list (payload size) | Schema says Library Item Expanded → Podcast Expanded includes episodes — **likely full**; **confirm with live probe** before treating search as a light series-only payload |

**Verdict for the map:** Yes — library search returns usable podcast show hits under `podcast[]` with the same search-result wrapper as books. Safe for “library series search.” Episode-in-library search is not a separate documented facet of this endpoint.

---

## 7. Confirmed: discovery vs RSS episode search (out of browse Search)

### `GET /api/search/podcast?term=...`

- **iTunes** podcast discovery.
- Returns an array of iTunes-shaped objects (`id`, `artistId`, `title`, `artistName`, `feedUrl`, `cover`, `trackCount`, …).
- **Not** in-library browse search.

**Source:** [Search for Podcasts](https://api.audiobookshelf.org/#search-for-podcasts) — “This endpoint searches iTunes for podcasts…”

### `GET /api/podcasts/<libraryItemId>/search-episode?title=...`

- Searches the podcast’s **RSS feed** for an episode title (Levenshtein-ranked feed episodes).
- Response: `{ episodes: [{ episode: Podcast Feed Episode, levenshtein }] }` — feed-shaped, not necessarily already-downloaded library episodes.
- Requires feed URL; 500 if not a podcast / missing title / no feed.

**Source:** [Search a Podcast's Feed for Episodes](https://api.audiobookshelf.org/#search-a-podcast-s-feed-for-episodes)

Both confirmed **out of scope** for in-library browse Search per map #5.

---

## Endpoint cheat sheet (LAABS)

| Need | Endpoint |
| --- | --- |
| List shows (paginated, thin) | `GET /api/libraries/:id/items?minified=1&limit=&page=` |
| Recent unfinished episodes | `GET /api/libraries/:id/recent-episodes?limit=&page=` |
| Home Continue / recent episode shelves | `GET /api/libraries/:id/personalized` (`type: episode`, `recentEpisode`) |
| Show detail + episodes | `GET /api/items/:id?expanded=1` → `media.episodes` |
| One episode | `GET /api/podcasts/:id/episode/:episodeId` |
| Start episode playback | `POST /api/items/:id/play/:episodeId` → Playback Session Expanded |
| Session tick / end | `POST /api/session/:id/sync`, `.../close` |
| Read/write episode progress | `GET|PATCH /api/me/progress/:libraryItemId/:episodeId` (+ batch / sync-local) |
| In-library show search | `GET /api/libraries/:id/search?q=` → `{ podcast: [...] }` |
| iTunes discovery (not browse) | `GET /api/search/podcast?term=` |
| RSS feed episode search (not browse) | `GET /api/podcasts/:id/search-episode?title=` |

---

## Sources

1. https://api.audiobookshelf.org — primary; sections linked above.
2. Secondary notes in-repo (`podcastreasearch.md`) were **not** used as authority for this write-up.
