# ABS API Access

This document describes the API modules under `src/api` and how to call them. Each module is designed around `fetch` via `absClient`, which automatically injects auth tokens and server URL via `authFetch`.

**Common patterns**
- All API functions return Promises.
- Library-scoped helpers require an explicit `libraryId`; hooks and screens read the Active Library and pass it into API modules.
- API modules should not fall back to `authStore.getState().activeLibraryId` for normal library-scoped requests.
- Errors are thrown as `AbsApiError`, `AbsOfflineError`, or `AbsAuthRequiredError` when relevant (see `abs-client.ts`).

## `src/api/abs-client.ts`

**Purpose**: Central HTTP client that wraps `authFetch`, normalizes auth failures, and parses JSON responses.

**Key exports**
- `AbsApiError`, `AbsAuthRequiredError`, `AbsOfflineError`
- `absClient.request`, `absClient.get`, `absClient.post`, `absClient.put`, `absClient.patch`, `absClient.delete`

**Usage**
```ts
import { absClient } from "../api/abs-client";

const data = await absClient.get<MyType>("/api/libraries");
```

## `src/api/auth-fetch.ts`

**Purpose**: Auth-aware `fetch` wrapper. Pulls tokens and server URL from `authStore` and retries once on 401 after refreshing the token.

**Key exports**
- `authFetch(path, options)`
- `AuthUnavailableError`
- `shouldRefreshSoon()` and `getAccessTokenExpiry()`

**Usage**
You should not call `authFetch` directly except in `abs-client`. Use `absClient` in all API modules.

## `src/api/libraries-api.ts`

**Purpose**: Library listing and library-scoped metadata.

**Key exports**
- `librariesApi.getAll()`
- `librariesApi.getFilterData(libraryId)`

**Usage**
```ts
import { librariesApi } from "../api/libraries-api";

const { libraries } = await librariesApi.getAll();
const filterData = await librariesApi.getFilterData(libraryId);
```

## `src/api/library-items-api.ts`

**Purpose**: Library-scoped item lists and derived metadata summaries used by screens.

Notes:
- `getItems({ libraryId })` returns metadata for one Library only (title/author/cover/duration/etc.).
- User state (progress/bookmarks/finished) is fetched separately from `meApi.getUserServerState()` and merged in hooks.

**Key exports**
- `libraryItemsApi.getItems({ libraryId, filterType, filterValue, sortBy, page, limit })`
- `libraryItemsApi.getFinishedItems(libraryId)`
- `libraryItemsApi.getFavorites(libraryId, favoriteTag?)`
- `libraryItemsApi.getFavoritedAndFinishedItems(libraryId)`

**Usage**
```ts
import { libraryItemsApi } from "../api/library-items-api";

const items = await libraryItemsApi.getItems({
  libraryId,
  filterType: "genres",
  filterValue: "RmFudGFzeQ==",
  sortBy: "addedAt",
});

const favorites = await libraryItemsApi.getFavorites(libraryId);
const finished = await libraryItemsApi.getFinishedItems(libraryId);
const both = await libraryItemsApi.getFavoritedAndFinishedItems(libraryId);
```

## `src/api/items-api.ts`

**Purpose**: Single item detail and per-item updates.

**Key exports**
- `itemsApi.getItemDetails(itemId)`
- `itemsApi.updateMediaTags(itemId, tags)`

**Usage**
```ts
import { itemsApi } from "../api/items-api";

const details = await itemsApi.getItemDetails(itemId);
await itemsApi.updateMediaTags(itemId, ["favorite"]);
```

## `src/api/me-api.ts`

**Purpose**: User-scoped endpoints and normalized user server state.

**Key exports**
- `meApi.getMe()`
- `meApi.getProgress(itemId)`
- `meApi.updateProgress(itemId, { currentTime, isFinished })`
- `meApi.saveBookmark(itemId, bookmark)`
- `meApi.deleteBookmark(itemId, positionSeconds)`
- `meApi.removeFromContinueListening(progressId)`
- `meApi.getUserServerState()`
- `meApi.getItemsInProgress(libraryId)`

**Usage**
```ts
import { meApi } from "../api/me-api";

const me = await meApi.getMe();
const progress = await meApi.getProgress(itemId);
await meApi.updateProgress(itemId, { currentTime: 120 });
await meApi.saveBookmark(itemId, { time: 120, title: "Chapter 1" } as Bookmark);
await meApi.deleteBookmark(itemId, 120);
await meApi.removeFromContinueListening(progressId);
const userServerState = await meApi.getUserServerState();

const inProgress = await meApi.getItemsInProgress(libraryId);
```

## `src/api/sessions-api.ts`

**Purpose**: Playback session lifecycle (close and sync).

**Key exports**
- `sessionsApi.closeSession(sessionId, data)`
- `sessionsApi.syncSession(sessionId, data)`

**Usage**
```ts
import { sessionsApi } from "../api/sessions-api";

await sessionsApi.syncSession(sessionId, { timeListened: 30, currentTime: 120 });
await sessionsApi.closeSession(sessionId, { timeListened: 30, currentTime: 120 });
```

## `src/api/playback-api.ts`

**Purpose**: Fetch play info for streaming.

**Key exports**
- `playbackApi.getPlayInfo(itemId)`

**Usage**
```ts
import { playbackApi } from "../api/playback-api";

const session = await playbackApi.getPlayInfo(itemId);
```

## `src/api/playlists-api.ts`

**Purpose**: Read and mutate Audiobookshelf playlists that are projected into Home playlist shelves.

**Key exports**
- `playlistsApi.getLibraryPlaylists(libraryId)`
- `playlistsApi.getPlaylist(playlistId)`
- `playlistsApi.createPlaylist({ libraryId, name, description, items })`
- `playlistsApi.renamePlaylist(playlistId, name)`
- `playlistsApi.setPlaylistItems(playlistId, orderedLibraryItemIds)`
- `playlistsApi.batchAddItems(playlistId, libraryItemIds)`
- `playlistsApi.batchRemoveItems(playlistId, libraryItemIds)`
- `playlistsApi.deletePlaylist(playlistId)`

**Usage**
```ts
import { playlistsApi } from "../api/playlists-api";

const playlists = await playlistsApi.getLibraryPlaylists(libraryId);
await playlistsApi.batchAddItems(playlistId, [libraryItemId]);
```

## `src/api/series-api.ts`

**Purpose**: Fetch a series with server progress included.

**Key exports**
- `seriesApi.getSeriesWithProgress(seriesId)`

**Usage**
```ts
import { seriesApi } from "../api/series-api";

const series = await seriesApi.getSeriesWithProgress(seriesId);
```

## `src/api/track-builder.ts`

**Purpose**: Legacy TrackPlayer-era helper kept in the repo for reference only.

Current status:
- imports `react-native-track-player`
- is not used by the live playback path
- should not be the starting point for current audio-engine work

**Key exports**
- `buildTrackPlayerTracks(playbackData)`

**Usage**
```ts
import { playbackApi } from "../api/playback-api";
import { buildTrackPlayerTracks } from "../api/track-builder";

const session = await playbackApi.getPlayInfo(itemId);
const track = buildTrackPlayerTracks(session);
```

## `src/api/authors-api.ts`

**Purpose**: Author lookups with items.

**Key exports**
- `authorsApi.getAuthorWithItems(authorId)`

**Usage**
```ts
import { authorsApi } from "../api/authors-api";

const author = await authorsApi.getAuthorWithItems(authorId);
```

## `src/api/cover-urls.ts`

**Purpose**: Build cover URLs with and without token in query string.

**Key exports**
- `buildCoverUrls(itemId, { format, width, token, serverUrl })`

**Usage**
```ts
import { buildCoverUrls } from "../api/cover-urls";

const urls = buildCoverUrls(itemId);
```

## `src/api/favorites-api.ts`

**Purpose**: Generate favorite tag values and base64 search tokens.

**Key exports**
- `favoritesApi.getUserFavoriteInfo()`

**Usage**
```ts
import { favoritesApi } from "../api/favorites-api";

const { favoriteSearchString } = favoritesApi.getUserFavoriteInfo();
```

## `src/api/downloads-api.ts`

**Purpose**: Ebook download flow (download spec + side effects).

**Key exports**
- `downloadsApi.getDownloadSpec(itemId, fileIno)`
- `downloadsApi.downloadEbook(itemId, fileIno, filenameWithExt)`

**Usage**
```ts
import { downloadsApi } from "../api/downloads-api";

const spec = await downloadsApi.getDownloadSpec(itemId, fileIno);
await downloadsApi.downloadEbook(itemId, fileIno, "book.epub");
```
