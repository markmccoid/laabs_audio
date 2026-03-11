# Deep Linking

## Overview

The app uses the custom scheme `laabsaudio`.

For shared books, the public deep link format is:

```ts
laabsaudio:///{libraryItemId}
```

That URL is created with `expo-linking` in [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/navigation/book-links.ts`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/navigation/book-links.ts):

```ts
Linking.createURL(`/${libraryItemId}`);
```

Even though the internal Expo Router route is `/(tabs)/(home)/[libraryItemId]`, the public URL does not include `(tabs)` or `(home)` because those are route groups.

## Sharing A Book

The share action is triggered from the `Link.MenuAction` inside [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/components/bookComponents/BookContainer.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/components/bookComponents/BookContainer.tsx).

The actual share logic lives in [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/sharing/book-share.ts`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/sharing/book-share.ts).

Current share behavior:

- Build the deep link with `Linking.createURL`.
- Build the remote cover image URL directly from `libraryItemId`.
- Use the tokened cover URL when `useTokenWithCoverImages` is enabled and a token is available.
- Open the native share sheet with:

```ts
await Share.share({
  message: `${title} -> Open in LAAB -> ${deepLink}`,
  url: remoteCoverUri,
});
```

Important detail:

- The deep link is placed in `message`.
- The `url` field is the remote book cover URI derived from `libraryItemId`.
- We do not put the deep link in `url`; the cover image and the route link are intentionally separated.

## What `book-links.ts` Is For

[`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/navigation/book-links.ts`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/navigation/book-links.ts) is the single small utility for book-link behavior.

It currently does three things:

- `getBookDetailHref(libraryItemId)`
  - returns the internal Expo Router href object for navigation to `/(tabs)/(home)/[libraryItemId]`
- `createSharedBookLink(libraryItemId)`
  - creates the public deep-link URL that is shared outside the app
- `extractBookDetailIdFromUrl(url)`
  - parses an incoming deep link and extracts the `libraryItemId`

Keeping those behaviors together avoids duplicating route-path assumptions in multiple files.

## Cold Start Behavior

Warm-start deep links work automatically because Expo Router is already running and can navigate immediately.

Cold-start deep links needed one extra guard in [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx).

### The Problem

On app launch, the root layout had fallback logic that redirected authenticated users to:

```ts
router.replace("/(tabs)/(home)");
```

During a cold start from a shared deep link, that fallback could run before the router had fully settled on the incoming detail route. The result was:

- deep link opens app
- app lands on Home
- detail screen is lost

### The Fix

The root layout now:

1. Calls `Linking.getInitialURL()` once on startup.
2. Uses `extractBookDetailIdFromUrl(...)` from `book-links.ts` to detect whether launch came from a shared book link.
3. Stores that `libraryItemId` while startup is resolving.
4. Suppresses the default `router.replace("/(tabs)/(home)")` redirect while that startup deep link is pending.

This gives Expo Router time to finish resolving the incoming route on a cold start.

## Cold Start While Logged Out

If the app is opened from a shared book link while the user is anonymous:

- root layout redirects to `/login`
- the `libraryItemId` from the original deep link is passed as `returnToLibraryItemId`
- after successful login, [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/login.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/login.tsx) navigates back to the book detail route

That preserves the original deep-link intent through authentication.

## Back Button On Cold Start

Cold-starting directly into `[libraryItemId]` can leave the stack without a prior screen, which means no back button.

To fix that, [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/(tabs)/(home)/_layout.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/(tabs)/(home)/_layout.tsx) sets:

```ts
export const unstable_settings = {
  initialRouteName: "index",
};
```

That tells Expo Router the Home stack should treat `index` as the base route, so a deep-linked book detail screen has proper back navigation.

## Related Files

- [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/navigation/book-links.ts`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/navigation/book-links.ts)
- [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/sharing/book-share.ts`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/sharing/book-share.ts)
- [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/components/bookComponents/BookContainer.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/components/bookComponents/BookContainer.tsx)
- [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx)
- [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/login.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/login.tsx)
- [`/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/(tabs)/(home)/_layout.tsx`](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/(tabs)/(home)/_layout.tsx)
