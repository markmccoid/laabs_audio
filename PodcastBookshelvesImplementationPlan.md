# Podcast Bookshelves Implementation Plan

## Outcome

Make podcast Home shelves obey **Settings → Bookshelves** while preserving podcast-specific data and presentation. A podcast Library starts with four visible shelves in this order:

1. Continue Listening
2. Recent Episodes
3. Podcasts
4. Downloaded

Users can hide/show and reorder those shelves, choose each shelf's Home preview count, create device-only Episode Shelves, create Audiobookshelf-backed Playlist Shelves, assign Episodes from every Episode presentation, and reorder Episodes inside sortable shelf detail views.

No existing podcast bookshelf-settings migration is required because the podcast experience is only deployed on the test device. CarPlay and multi-Episode playback queues are explicitly out of scope.

## Product Rules

### Shelf kinds

Model podcast Home shelves as a discriminated union rather than adapting Podcasts or Episodes into book-shaped records:

```ts
type PodcastHomeShelf =
  | PodcastDerivedEpisodeShelf
  | PodcastDerivedPodcastShelf
  | PodcastDeviceEpisodeShelf
  | PodcastPlaylistEpisodeShelf;
```

- `derivedEpisode`: Continue Listening, Recent Episodes, and Downloaded. These contain Episodes and retain their existing derived ordering, except Downloaded also supports a user-defined local display order.
- `derivedPodcast`: the one built-in Podcasts Shelf. It contains Podcasts from the Podcast Series Index ordered by `addedAt` descending.
- `deviceEpisode`: a user-created, device-only ordered collection of Episodes.
- `playlistEpisode`: an ordered Episode Shelf backed by an Audiobookshelf playlist.

The explicit union must carry the item type in its shape (`episodes` versus `podcasts`), not infer it from a title or renderer special case. The Podcasts Shelf is never a membership destination and cannot be renamed or deleted.

### Visibility and empty shelves

- All four built-ins default to visible in the default order above.
- A shelf enabled in Settings remains on Home when empty and presents an appropriate empty message.
- A shelf hidden from Home remains a valid Episode membership destination.
- A suppressed or Missing Playlist Shelf is not a membership destination.
- Newly discovered server playlists appear in Settings but default to hidden.
- Shelves created inside LAABS Audio default to visible.

### Membership and scope

- Device-only and Playlist Episode Shelves contain Episodes only, identified by `(libraryItemId, episodeId)`.
- A shelf may mix Episodes from different Podcasts in the same active podcast Library.
- Shelf state is scoped to the Audiobookshelf User Identity and Library through the existing Home scope key.
- No membership can cross user, server session, or Library scope.
- Adding an Episode appends it to the current explicit order; users can subsequently drag it elsewhere.
- Removing or finishing an Episode does not remove it from an explicit Episode Shelf.

### Playlist synchronization

- Creating a Playlist Shelf requires an authenticated online Audiobookshelf connection.
- Renames, membership changes, removals, and reordering of an existing Playlist Shelf are optimistic and can queue offline.
- On reconnect, fetch the latest server playlist and replay queued local intents in creation order.
- Add/remove intents merge with unrelated server changes.
- A reorder intent orders surviving locally known Episodes first and retains server-only Episodes afterward in their current server order.
- A remote Episode deletion is not resurrected unless a queued local add explicitly requests it.
- A remotely deleted playlist becomes a Missing Playlist Shelf; queued operations do not recreate it.
- Device-only → Playlist conversion creates the server playlist and uploads the current Episode order before replacing the local shelf. On any failure, the device-only shelf remains unchanged.
- “Remove from app view” suppresses a Playlist Shelf locally without deleting it from Audiobookshelf. “Delete from Audiobookshelf” deletes both the server playlist and its local projection/settings.

## Architecture

### Keep media assembly parallel

Retain the separation established by ADR-0026:

- `useHomeShelves()` remains the audiobook assembly path.
- Add `usePodcastHomeShelves()` for podcast Libraries.
- Share settings primitives, management view models, and typed playlist transport where useful; do not add media-type branches throughout the audiobook hook.
- Route-level components choose the correct media-specific provider from `useActiveLibraryExperience()`.

This keeps the book SQLite Home projection untouched and lets podcast shelves retain Episode Identity, Podcast identity, and their distinct data sources.

### Dedicated persisted podcast shelf store

Add `src/store/podcast-shelves-store.ts`, using the existing MMKV/Zustand persistence conventions. It owns only podcast shelf operational state:

- Device-only shelves by Home scope.
- Playlist Shelf projections by Home scope.
- Ordered Episode Identity keys for each explicit shelf.
- Durable Episode presentation snapshots by Home scope for shelf-only Episodes.
- Suppressed playlist IDs.
- Pending playlist operations.
- Downloaded Episode display order.

Use a presentation snapshot similar to:

```ts
type PodcastShelfEpisodeSnapshot = EpisodeIdentity & {
  title: string;
  podcastTitle: string;
  cover: string | null;
  coverFull: string | null;
  durationSeconds: number;
  publishedAt: number | null;
};
```

Shelf membership therefore makes an Episode a Touched Episode in the domain sense without forcing shelf-only metadata into the listening-progress SQLite table. The store should deduplicate snapshots by `episodeIdentityKey()` and remove unreferenced shelf-only snapshots during normal reconciliation where safe.

Keep `src/store/settings-store.ts` responsible for:

- `shelfOrder`
- `isVisible`
- `homeItemCount`

Use these podcast derived IDs: `continueListening`, `recentEpisodes`, `podcasts`, and `downloaded`. New local IDs must use a podcast-specific prefix; Playlist Shelf IDs should continue to be deterministically derived from the ABS playlist ID.

### Typed Audiobookshelf playlist API

Refactor `src/api/playlists-api.ts` so it preserves the full playlist media reference:

```ts
type BookPlaylistItemRef = {
  mediaKind: "book";
  libraryItemId: string;
};

type EpisodePlaylistItemRef = {
  mediaKind: "episode";
  libraryItemId: string;
  episodeId: string;
  episode: PodcastShelfEpisodeSnapshot | null;
};
```

Audiobookshelf requires both `libraryItemId` and `episodeId` for podcast playlist entries. Update create, batch add/remove, and set-items payload builders to send that pair. Preserve book callers through typed overloads or media-specific helpers so the existing audiobook playlist behavior does not regress.

Normalize expanded playlist responses without dropping `episodeId` or Episode metadata. Reject malformed podcast entries rather than treating the parent Podcast as a playable playlist item.

### Podcast shelf assembly

Add `src/hooks/use-podcast-home-shelves.ts`. It should assemble:

- Continue Listening from the existing Touched Episode progress reader plus Active Playback overlay.
- Recent Episodes from the existing live/snapshot assembly plus local progress overlays.
- Podcasts directly from `PodcastSeriesIndexSummary[]`, ordered by `addedAt` descending.
- Downloaded from the existing Episode download facade, then apply the stored local order.
- Device-only shelves by joining ordered Episode keys to durable snapshots and the newest progress/download overlays.
- Playlist Shelves by joining normalized server/local playlist entries to snapshots and overlays.

Apply stored shelf order, visibility, and preview counts after assembly. Return both all shelves for Settings/detail screens and visible preview shelves for Home. Do not filter out empty visible shelves.

The hook should also own the React Query bridge that:

- Fetches active-Library playlists only for authenticated podcast Libraries.
- Reconciles successful server results into `podcast-shelves-store`.
- Marks absent server playlists Missing only after a successful complete response.
- Retains the last successful local projection on network failure.

### Synchronization lifecycle

Add a podcast playlist synchronization service separate from React rendering. Invoke it:

- Post-readiness during podcast Library activation, without making playlists an activation gate.
- When podcast Home or Settings opens and playlist data is stale.
- During podcast Home pull-to-refresh.
- On reconnect when pending operations exist.
- Immediately after online LAABS playlist mutations.

Pull-to-refresh should refresh Recent Episodes, the stale Podcast Series Index, playlist reconciliation, and pending playlist operations. One failed concern should report an appropriate non-blocking status without discarding successful results from the others.

## UI Work

### Home

Refactor `src/components/podcast/podcast-home-shelves-screen.tsx` to render the ordered `visibleShelves` returned by `usePodcastHomeShelves()` instead of constructing a fixed `PodcastHomeListItem[]`.

- Render derived/custom/playlist Episode shelves with a podcast Episode shelf section component.
- Render the Podcasts Shelf with a Podcast-specific section accepting `PodcastSeriesIndexSummary[]`; stop mapping Podcasts through `podcastShowToShelfSummary()` solely to satisfy book types.
- Retain the current Podcast and Episode card appearance where practical.
- Make shelf headers navigate to the correct full view: Podcasts → podcast browser; Episode shelves → Episode Shelf detail.
- Preserve the current Active Playback overlay and horizontal shelf behavior.

### Settings → Bookshelves

Keep the existing route, but branch to a media-specific provider beneath it. Extract shared visual components for:

- Ordered shelf list and drag behavior.
- Visibility toggle.
- Visible-only filter.
- Preview-count editor.
- Playlist sync/missing/suppressed indicators.

Add a podcast-specific management adapter and editor because its discriminated types and membership payloads are not books.

Podcast editor rules:

- All shelves allow visibility and preview-count changes.
- Built-ins cannot be renamed or deleted.
- Device-only shelves can be renamed, deleted, or converted to Playlist Shelves.
- Playlist Shelves can be renamed, suppressed/restored, or deleted from Audiobookshelf.
- “New Shelf” offers Playlist Shelf and Device-only Shelf.
- Playlist creation is disabled with a clear explanation when no authenticated online server connection is available.

### Episode membership actions

Extend the Episode Action domain in `src/podcast/episode-action-eligibility.ts` and `src/components/podcast/episode-action-controller.ts` with `bookshelves`.

- Include it in every phone Episode Action Set.
- Build checked membership options from all non-suppressed, non-missing device-only and Playlist Episode Shelves, including shelves hidden from Home.
- Reuse the nested-menu/bottom-sheet interaction conventions from the book action system while retaining Episode Identity payloads.
- A playlist mutation may remain selectable offline when it can be queued; disable only when the session/scope cannot own a safe queued operation.

Update every Episode presentation that selects an action set, including Home shelves, Current Podcast rows, downloads, and Episode Detail.

In `src/components/podcast/episode-quick-actions.tsx`, add a Bookshelves button directly beneath/after Download using the same visual hierarchy as the book quick actions. It opens a podcast Episode Bookshelves bottom sheet showing membership checkmarks and a link to Settings → Bookshelves.

### Episode Shelf detail

Add a podcast Episode Shelf detail component selected by the existing Home bookshelf route or a media-specific sibling route.

- Use a vertical Episode list with title, Podcast name, publication date, duration, progress, and download state.
- Primary tap opens Episode Detail.
- Long-press exposes the full Episode Action Set.
- Device-only, Playlist, and Downloaded shelves use a dedicated drag handle.
- Continue Listening and Recent Episodes retain derived ordering and have no drag handle.
- Reordering a Playlist Shelf is optimistic and queued when offline.
- No shelf starts a multi-Episode playback queue; play actions load only the selected Episode.

## Failure and Edge Cases

- Empty visible shelves render their empty message on Home and detail screens.
- Duplicate Episode IDs under different Podcasts do not collide because all keys use the full Episode Identity.
- The same Episode cannot appear twice in one explicit shelf.
- A hidden shelf remains assignable; a suppressed or Missing Playlist Shelf does not.
- If a Playlist Shelf response lacks Episode metadata, retain a known local snapshot; otherwise show a recoverable placeholder and fetch the parent Podcast details when online.
- A playlist refresh failure never marks playlists Missing.
- Server deletion while local operations are pending produces Missing state and surfaces that the operation could not be applied.
- Conversion never deletes the device-only shelf until server creation and complete ordered membership upload succeed.
- Switching Libraries while a mutation is in flight must finish against its captured user/Library scope and must not update the newly active scope.
- Offline shelf-only Episodes remain visible but are playable only when a Downloaded Audio Asset is available.

## Verification

### Automated tests

Add focused tests for:

1. `playlists-api`
   - Parse and emit `{ libraryItemId, episodeId }`.
   - Preserve book playlist requests.
   - Reject malformed podcast items without treating Podcasts as Episodes.
2. `podcast-shelves-store`
   - User/Library isolation.
   - Create, rename, delete, suppress/restore, membership, deduplication, and ordering.
   - Durable shelf-only Episode snapshots.
   - Device-only → Playlist conversion success and rollback.
   - Downloaded Episode ordering with new downloads retained.
3. Playlist operation replay
   - Offline add/remove/reorder/rename.
   - Latest-server-state merge.
   - Remote-only Episode retention.
   - Remote Episode and playlist deletion.
   - Scope switch during an in-flight request.
4. `usePodcastHomeShelves` pure assembly helpers
   - Default order and visibility.
   - Stored hide/show/reorder/count settings.
   - Empty visible shelves remain present.
   - Podcasts contain Podcast summaries; all other shelf kinds contain Episodes.
   - New server playlists hidden; LAABS-created shelves visible.
5. Episode actions
   - Bookshelves is present in every phone Episode Action Set.
   - Membership options include hidden shelves and exclude suppressed/Missing playlists and Podcasts.
6. Routes and detail behavior
   - Podcasts “See All” opens the podcast browser.
   - Episode shelf rows open Episode Detail.
   - Only sortable shelf kinds expose drag handles.

Run targeted Jest suites during each phase, then:

```sh
npm test -- --runInBand
npm run lint
npx tsc --noEmit
```

### Test-phone acceptance pass

- Activate a podcast Library with no saved shelf settings and verify the four default shelves/order.
- Hide, show, reorder, and change preview counts; restart the app and verify persistence.
- Verify all four shelves remain present when empty and show useful messages.
- Create a visible device-only shelf; add Episodes from Home, Podcast detail, downloads, and Episode Detail.
- Confirm the Episode Detail Bookshelves button is under Download and reflects membership immediately.
- Mix Episodes from multiple Podcasts; restart offline and verify metadata remains visible.
- Drag Episodes in device-only, Playlist, and Downloaded shelf details.
- Create a Playlist Shelf and verify it and its ordered Episode pairs on Audiobookshelf.
- Create a server playlist in another client; verify it appears hidden in Settings, then enable it.
- Queue playlist add/remove/reorder changes offline, make unrelated server changes elsewhere, reconnect, and verify intent replay preserves both.
- Convert a device-only shelf; simulate failure and verify the original remains, then retry successfully.
- Suppress/restore a Playlist Shelf and separately delete one from Audiobookshelf.
- Delete a playlist remotely and verify it disappears after a successful refresh.
- Switch between audiobook and podcast Libraries and verify their shelf settings/membership never leak.
- Confirm CarPlay behavior and single-Episode playback behavior are unchanged.

## Implementation Sequence

Keep commits reviewable and leave audiobook behavior green after every step:

1. **Preserve typed podcast playlist items** — extend playlist API parsing/payload tests while keeping existing book callers compatible.
2. **Add the persisted podcast shelf domain store** — local/playlist models, snapshots, selectors, operations, and store tests.
3. **Add playlist reconciliation and offline intent replay** — server merge rules, lifecycle service, and conflict tests.
4. **Assemble configurable podcast Home shelves** — new typed hook/pure assembly helpers and settings integration tests.
5. **Drive podcast Home and shelf detail from the assembly** — typed Podcast/Episode sections, empty states, navigation, and vertical sortable detail.
6. **Add podcast bookshelf Settings management** — media-specific provider/editor using shared list controls.
7. **Add Episode membership everywhere** — action-menu membership plus the Episode Detail quick-action bottom sheet.
8. **Wire refresh/reconnect/activation synchronization** — non-blocking lifecycle triggers and error presentation.
9. **Finish regression and device acceptance coverage** — full tests, lint/typecheck, and tester-facing verification notes.

If these changes are committed, each commit must also add the newest tester-facing entry to `NEW_FEATURES.md` as required by the repository instructions.
