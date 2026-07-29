# Local Episode Bookmarks and Clips

**Status:** accepted (amends the bookmark/clip non-goal in the Podcast reuse inventory)

LAABS Audio owns Podcast Episode bookmark state locally by full Episode Identity:
`libraryItemId + episodeId`. Episode bookmarks may be Point Bookmarks or Clip Bookmarks and use the
same local notes, range editing, preview, downloaded-audio trimming, temporary sharing, and iOS
transcription capabilities as Book bookmarks.

Episode bookmarks are not sent to Audiobookshelf. The current Audiobookshelf bookmark model is
scoped only by parent `libraryItemId` and timestamp, so a Podcast bookmark cannot identify an
Episode and may collide with the same timestamp in another Episode. Encoding Episode identity in a
bookmark title is not an interoperable substitute.

## Consequences

- Episode bookmarks live in a separate, versioned MMKV store keyed by user and Episode Identity.
- Their server status is explicitly `unsupported`; they never enter Book bookmark reconciliation or
  pending ABS create/delete queues.
- Book bookmark records, persisted keys, server links, retry queues, and routes remain unchanged.
- Clip preview compares both the Podcast library-item id and Episode id.
- Clip export uses a media-source seam: Books keep their existing multi-track resolver; downloaded
  Episodes provide a single episode-relative track.
- Bookmarks use one shared list, add/detail editor, and advanced Clip Editor presentation. Book and
  Episode controllers adapt persistence, playback loading, source planning, and export metadata at
  the media seam; the Book experience remains the visual and interaction source of truth.
- Episode bookmark backup export matches the Book JSON/CSV workflow while including full Episode
  Identity and `serverStatus: "unsupported"`.
- Generated audio and transcript files remain temporary and are deleted after sharing or failure.
- A future ABS endpoint with Episode/media identity can add synchronization without changing the
  local Episode Bookmark identity.
