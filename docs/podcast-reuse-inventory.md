# Podcast reuse inventory (book vs Podcast / Episode)

Architecture handoff inventory from [Reuse inventory for book vs podcast surfaces](https://github.com/markmccoid/laabs_audio/issues/13). Not an implementation plan — what to share vs fork.

Related ADRs: 0024 (storage), 0025 (Activation), 0026 (Home), 0027 (show detail), 0028 (CarPlay).

## Reuse as-is (shell)

- Tab shell (`Home` / Lists / Settings / Search) and mini-player accessory
- Root app chrome: auth bootstrap, Library Selection gate, Library Activation overlay, offline banner, download toast coordinator, CarPlay shelf publisher mount
- Library Selection / Activation **UX** (picker, overlay, Retry/Cancel) — podcast only changes the ready-predicate
- User Session / access-mode flows
- CarPlay **single-root** native template tree (not a second CarPlay root)
- SQLite connection / schema-ensure / scope helpers only (`shadow-db-core` and kin)

## Parallel / fork (Podcast and Episode models)

| Area | Book path (leave alone) | Podcast path |
| --- | --- | --- |
| Activation readiness | Existing book warm/catalog behavior | Podcast Series Index ready (ADR 0025) |
| Home assembly | `use-home-shelves` + book home SQLite | Parallel Continue / Recent / Podcasts / Downloaded (ADR 0026, 0029) |
| Home cards / actions | Book shelf cards, Favorite, shelf membership | Episode vs Podcast row presentations; no book shelf actions |
| Lists tab | Series / Collections / Playlists | Podcast Series Index browser → Current Podcast |
| Search data | Book Search Expression, facets | Series-index FTS (title/author); hide book facets for v1 |
| Search chrome | Tab + search field + results shell | Reuse tab chrome; swap data path |
| Detail | `BookContainer` / book routes | Current Podcast + Episode Detail Sheet (ADR 0027) |
| SQLite catalog / progress | `library_catalog_*`, book progress tables | Parallel series-index + Touched Episode tables/modules (ADR 0024) |
| CarPlay publish | Book shelves from book Home | Parallel podcast shelves; no Chapters Up Next for Episodes (ADR 0028) |
| Book-only sheets | Bookshelves, book series, bookmarks, clips | Not on podcast browse path |

## Share chrome, widen identity

**Share:** mini player, main player shell, transport controls, rate, sleep timer, progress-sync pipeline *shape*, download operational patterns (queue/files/toasts), cover/theme chrome.

**Widen:** Active Playback, Player Display, Playback Start Attempt, Progress Sync Intent, and related helpers accept **Episode Identity** (not only Audiobook Identity). Neutral renames of book-shaped helper names are preferred over time, not a v1 hard gate.

**Hide / no-op for Episodes:** chapter list UI, CarPlay Up Next/Chapters, bookmark/clip surfaces, book shelf-membership actions. Podcast Home uses an Episode **Downloaded** shelf (not audiobook Downloaded rows).

**Downloads / progress:** Episode-scoped Downloaded Audio Assets and Progress Sync Intents parallel to books — do not treat episodes as rows in book download/progress maps (ADR 0029).

## Explicit non-goals for this inventory

- Rewriting the book SQLite catalog or Home/Search modules into media-type-agnostic code
- Podcast Favorites (still unspecified)
- Android Auto
