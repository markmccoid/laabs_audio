# ABS API Access

This document describes the API modules under `src/api` and how to call them. Each module is designed around `fetch` via `absClient`, which automatically injects auth tokens and server URL via `authFetch`.

**Common patterns**
- All API functions return Promises.
- Most helpers accept a `libraryId` optional param. If omitted, they fall back to `authStore.getState().activeLibraryId`.
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
- `librariesApi.getFilterData(libraryId?)`
- `librariesApi.getPersonalized(libraryId, { limit })`

**Usage**
```ts
import { librariesApi } from "../api/libraries-api";

const { libraries } = await librariesApi.getAll();
const filterData = await librariesApi.getFilterData();
const shelves = await librariesApi.getPersonalized(libraryId, { limit: 16 });
```

## `src/api/library-items-api.ts`

**Purpose**: Library item lists and derived “summary” data used by screens.

**Key exports**
- `libraryItemsApi.getItems({ libraryId, filterType, filterValue, sortBy, page, limit })`
- `libraryItemsApi.getFinishedItems(libraryId?)`
- `libraryItemsApi.getFavorites(libraryId?, favoriteTag?)`
- `libraryItemsApi.getFavoritedAndFinishedItems(libraryId?)`

**Usage**
```ts
import { libraryItemsApi } from "../api/library-items-api";

const items = await libraryItemsApi.getItems({
  filterType: "genres",
  filterValue: "RmFudGFzeQ==",
  sortBy: "addedAt",
});

const favorites = await libraryItemsApi.getFavorites();
const finished = await libraryItemsApi.getFinishedItems();
const both = await libraryItemsApi.getFavoritedAndFinishedItems();
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

**Purpose**: User-scoped endpoints and shaped “items-in-progress”.

**Key exports**
- `meApi.getMe()`
- `meApi.getProgress(itemId)`
- `meApi.updateProgress(itemId, { currentTime, isFinished })`
- `meApi.saveBookmark(itemId, bookmark)`
- `meApi.deleteBookmark(itemId, positionSeconds)`
- `meApi.removeFromContinueListening(progressId)`
- `meApi.getItemsInProgress(libraryId?)`

**Usage**
```ts
import { meApi } from "../api/me-api";

const me = await meApi.getMe();
const progress = await meApi.getProgress(itemId);
await meApi.updateProgress(itemId, { currentTime: 120 });
await meApi.saveBookmark(itemId, { time: 120, title: "Chapter 1" } as Bookmark);
await meApi.deleteBookmark(itemId, 120);
await meApi.removeFromContinueListening(progressId);

const inProgress = await meApi.getItemsInProgress();
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

## `src/api/track-builder.ts`

**Purpose**: Converts an `AudiobookSession` into TrackPlayer-ready metadata.

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

## `src/api/image-utils.ts`

**Purpose**: Lightweight helpers for validating image URLs.

**Key exports**
- `getImageSize(uri)`
- `getCoverUri(coverUrl)`

**Usage**
```ts
import { getCoverUri } from "../api/image-utils";

const { coverUrl } = await getCoverUri(urls.coverFull);
```

## `src/api/shelves-api.ts`

**Purpose**: Personalized shelves builder (book shelves only).

**Key exports**
- `shelvesApi.getBookShelves(libraryId?)`
- `buildBookShelf(bookShelfItem)`

**Usage**
```ts
import { shelvesApi } from "../api/shelves-api";

const shelves = await shelvesApi.getBookShelves();
```
