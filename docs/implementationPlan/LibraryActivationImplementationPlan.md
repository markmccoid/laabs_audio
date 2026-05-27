# Library Activation Implementation Plan

## Goals
- Show visible progress when a user chooses a different Library.
- Block app interactions while the chosen Library is being activated.
- Commit the new Active Library only after required data is ready.
- Route to Home after successful user-requested Library Activation.
- Keep the implementation small, explicit, and aligned with existing React Query and auth-store patterns.

## Non-Goals
- Do not redesign Home shelves, Library Selection UI, or query persistence.
- Do not add a broad navigation state machine.
- Do not introduce a second persisted Active Library concept.
- Do not block activation on optional Home enhancements such as playlists.

## Required Activation Data
Library Activation succeeds when these keys are fresh or fetched successfully:

```ts
queryKeys.libraryBooks(libraryId)
queryKeys.userServerState(activeLibraryUserKey)
```

Library playlists may be prefetched opportunistically, but must not block activation:

```ts
queryKeys.libraryPlaylists(activeLibraryUserKey, libraryId)
```

## Implementation Steps

### 1. Add a Small Activation Module
Create a focused module, for example:

```txt
src/auth/library-activation.ts
```

Responsibilities:
- Accept the chosen `Library`.
- Require `activeLibraryUserKey`.
- Fetch or reuse fresh React Query data for required activation keys.
- Optionally prefetch playlists without failing activation.
- Return success or throw the underlying error.

Keep this as a plain async function, not a hook, so it can be called from screens and stores without adding UI concerns.

Suggested shape:

```ts
activateLibrary({
  library,
  activeLibraryUserKey,
  queryClient,
})
```

### 2. Add Minimal Global Activation State
Add transient activation state outside persisted auth fields. Prefer a small Zustand store or a focused slice near auth if that matches the existing style.

State:
- `status: "idle" | "activating" | "failed"`
- `library: Library | null`
- `errorMessage: string | null`

Actions:
- `start(library)`
- `fail(error)`
- `clear()`

Do not persist this state. Do not store pending Active Library IDs in `auth-store`.

### 3. Add a Global Activation Overlay
Mount one overlay near the root layout so it blocks every route and sheet.

Behavior:
- Shows while status is `activating` or `failed`.
- During activation, show an `ActivityIndicator` and text such as `Loading library`.
- On failure, show Retry and Cancel.
- Use a full-screen `View` or modal-style overlay with touch interception.

Keep copy generic and short. The chosen library name can appear as secondary text.

### 4. Centralize the Library Change Command
Create one command/hook for user-requested Library Selection, for example:

```txt
src/hooks/use-activate-library-selection.ts
```

Responsibilities:
1. Ignore selection of the already Active Library.
2. Start global activation state.
3. Run `activateLibrary(...)`.
4. On success, call `setActiveLibrary(...)`.
5. Clear activation state.
6. `router.replace("/(tabs)/(home)")`.
7. On failure, keep previous Active Library unchanged and show failed overlay state.

This is the only code path UI surfaces should call for user-requested Library changes.

### 5. Replace Existing Selection Call Sites
Update these call sites to use the centralized command:

- `src/components/Home/home-shelves-screen.tsx`
- `src/app/library-picker.tsx`
- `src/components/settings/settings-authentication-screen.tsx` only if it directly selects a Library; leave simple navigation to Library Selection alone.
- Any other `selectLibrary(...)` usage that represents user-requested Library Selection.

Keep `useLibrarySelection().selectLibrary` only for non-interactive setup flows if still needed, or rename/internalize it so new UI code does not bypass activation.

### 6. Handle Setup and No-Previous-Library Flows
For first login or setup Library Selection:
- Run Library Activation before committing the Active Library.
- On success, commit and route to Home, or to a return target only if that item exists in the activated catalog.
- On failure, Retry attempts the same Library again.
- Cancel returns to Library Selection when there is no previous Active Library.

Avoid `setTimeout` navigation delays. Let activation completion drive the transition.

### 7. Keep Cached Activation Fast
Use remembered activation data immediately when it exists. Do not wait for a server refresh only because React Query considers the cached data stale.

Requirements:
- Include `meta: { persist: true }` for persisted keys.
- Fetch only missing required activation data before committing the Active Library.
- Refresh existing cached activation data in the background.
- Do not invalidate old-library data during activation.

### 8. Opportunistic Playlist Prefetch
After required activation data succeeds, prefetch playlists in a non-blocking path:

```ts
void queryClient.prefetchQuery(...).catch(() => undefined);
```

Home already owns playlist empty/error behavior, so playlist failure must not stop activation.

## Clean Code Constraints
- One activation function for data readiness.
- One user-facing command for Library Selection.
- One global overlay for blocking UI.
- No duplicated prefetch arrays across Home, Library Picker, and root layout.
- No timers to simulate loading.
- No optimistic Active Library commit for user-requested Library Selection.
- No broad rewrites of auth bootstrap, routing guards, or Home shelf composition.

## Verification
- From Home, choose a large Library and confirm a blocking loading overlay appears immediately.
- Confirm Home is shown after activation succeeds.
- Confirm the previous Library remains visible if activation fails and Cancel is tapped.
- Confirm Retry attempts the same pending Library again.
- Confirm first-login multiple-Library setup still blocks browsing until activation succeeds.
- Confirm playlists can load after Home appears and playlist failure does not block activation.
- Confirm selecting the already Active Library does nothing.

Targeted checks:

```sh
npx eslint src/auth/library-activation.ts src/hooks/use-activate-library-selection.ts
npx eslint src/app/library-picker.tsx src/components/Home/home-shelves-screen.tsx src/app/_layout.tsx
```
