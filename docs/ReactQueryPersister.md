# React Query MMKV Persistence

This app uses TanStack Query (React Query) and persists **only selected queries** to a dedicated MMKV instance. This keeps the Zustand MMKV storage isolated, and avoids persisting sensitive or irrelevant query data.

## How It Works

1. A dedicated MMKV instance (`laabs-mmkv-query`) stores a serialized React Query cache snapshot.
2. The app uses `PersistQueryClientProvider`, which wraps `QueryClientProvider` and:
   - Restores the cache on startup.
   - Subscribes to cache updates and persists them.
3. Queries **opt in** to persistence by setting `meta: { persist: true }`.
4. The provider filters which queries are dehydrated using `shouldDehydrateQuery`.
5. The cache is **busted** when `activeLibraryUserKey` changes to prevent cross-account data.
6. On logout or library switch, the persisted cache is removed and the in-memory cache is cleared.

## Opting In a Query

To persist a query, add:

```ts
meta: { persist: true },
gcTime: 1000 * 60 * 60 * 24,
```

`gcTime` is set so the cache survives long enough for restore to be useful.

## Files Created

- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/store/mmkv-query-persister.ts`
  - MMKV-backed persister used by React Query.

## Files Updated

- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/app/_layout.tsx`
  - Replaced `QueryClientProvider` with `PersistQueryClientProvider`.
  - Added persist options and query filtering.
  - Clears persisted data on logout and library switch.
- `/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/hooks/abs-data-hooks.ts`
  - `useGetBooks` now opts into persistence.
