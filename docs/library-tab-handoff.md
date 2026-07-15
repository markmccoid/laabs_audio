# Library Tab — Phase 1 Scaffolding Handoff

_Last updated: 2026-07-11. Status: scaffolding complete; header layout iterated twice (see "Header approach history"); segmented control currently rendered via `Stack.Title asChild`. Awaiting/passed manual verification by Mark — confirm current on-device state before building on this._

## Goal

Add a third tab **Library** (between Home and Settings, SF symbol `books.vertical.fill`) that opens a
new stack whose top screen has an iOS segmented control with segments **Library / Collections /
Playlists** — matching the reference screenshot of the old app (segmented control in the header row,
ellipsis button top-right). iOS-only; UI built with SwiftUI components from `@expo/ui/swift-ui`.

**This phase is scaffolding only.** Each segment shows placeholder text. Phase 2 = wiring real data
(library items, collections, playlists).

## Files

### Created

| File | Purpose |
| --- | --- |
| `src/app/(tabs)/library/_layout.tsx` | Stack for the tab. Single `index` screen, `title: ""`, `headerTransparent: true`. Modeled on `settings/_layout.tsx`. |
| `src/app/(tabs)/library/index.tsx` | Thin route file; default-exports `LibraryTabScreen`. |
| `src/components/LibraryTab/library-tab-screen.tsx` | The whole screen: header composition (title picker + toolbars) and body placeholders. |

> Naming caution: `src/components/Library/` already exists and belongs to the **Search** feature.
> The new folder is deliberately `src/components/LibraryTab/`. Don't merge them.

### Modified

- `src/app/(tabs)/_layout.tsx` — replaced the old commented-out Library trigger with a real
  `<NativeTabs.Trigger name="library">` (Label "Library", `sf="books.vertical.fill"`,
  `md="library_books"` — note underscore; `library-books` fails typecheck). Sits between the
  `(home)` and `settings` triggers.

## Screen structure (`library-tab-screen.tsx`)

Rendered from the page component (not the layout) so the header elements share the screen's
`useState` for the selected segment:

```tsx
<Stack.Title asChild>                       // header CENTER (title view)
  <Host style={{ width: 260, height: 34 }}> // @expo/ui SwiftUI host — needs explicit size in header
    <Picker selection={selectedIndex} onSelectionChange={setSelectedIndex}
            modifiers={[pickerStyle("segmented")]}>
      {/* SwiftText per segment, tag(index) */}
    </Picker>
  </Host>
</Stack.Title>
<Stack.Toolbar placement="left">            // placeholder filter button (no-op console.log)
  <Stack.Toolbar.Button icon="line.3.horizontal.decrease" onPress={...} />
</Stack.Toolbar>
<Stack.Toolbar placement="right">           // ellipsis menu with stub actions
  <Stack.Toolbar.Menu icon="ellipsis">
    <Stack.Toolbar.MenuAction>Sort</...>    // no-op console.log
    <Stack.Toolbar.MenuAction>Filter</...>  // no-op console.log
  </Stack.Toolbar.Menu>
</Stack.Toolbar>

<View style={{ flex: 1, backgroundColor: themeColors.bg, paddingTop: headerHeight }}>
  <Host style={{ flex: 1 }}>
    <VStack>{/* one of LibrarySegment | CollectionsSegment | PlaylistsSegment */}</VStack>
  </Host>
</View>
```

- Segments: `LIBRARY_SEGMENTS = ["Library", "Collections", "Playlists"]`, `useState(0)` → default
  is "Library".
- Body placeholders are three tiny components (`LibrarySegment` etc.) meant to be replaced
  wholesale in phase 2.
- Header inset: `useHeaderHeight` from **`expo-router/react-navigation`** (this repo's import path,
  not `@react-navigation/elements`) + `paddingTop` on the wrapping `View` — same pattern as
  `src/components/settings/bookshelves/bookshelves-screen.tsx`.

## Header approach history (why it looks the way it does)

1. **v1:** picker in the screen body below a titled transparent header. Worked, but Mark wants the
   screenshot layout (picker in the header row).
2. **v2:** picker inside `<Stack.Toolbar placement="left">` as a `Stack.Toolbar.View` next to the
   button. **Failed on device: the entire left side rendered empty** (right ellipsis fine). Static
   analysis found no JS-side bug — on iOS, Button/Menu become `unstable_headerLeftItems` config
   dicts (`headerLeftBarButtonItems` in RNS) while `Toolbar.View` becomes a `type:'custom'` item
   rendered as `ScreenStackHeaderLeftView`; rns 4.25.2 native code supports mixing them. Root cause
   was never pinned down (live debugging session was cancelled); suspicion is the custom
   view inside left header items path, possibly iOS 26 / liquid-glass related.
3. **v3 (current):** picker moved to the header **center** via `Stack.Title asChild` → classic
   `headerTitle` → `ScreenStackHeaderCenterView` path, which is old and well-supported. Left
   toolbar holds only the button.

If v3's center view also fails to appear, the prime suspect is the fixed `width: 260` Host — UIKit
drops center title views that don't fit between the side buttons; try a smaller width or
`matchContents`. Fallback after that: `<Stack.Toolbar placement="left" asChild>` (maps to classic
`headerLeft`) containing a plain RN row with the button + picker.

## Relevant API internals (expo-router ~56.2.11)

Learned by reading `node_modules` — no public docs existed at the time:

- `Stack.Toolbar` (`placement="left" | "right" | "bottom"`), `Stack.Toolbar.Button/Menu/MenuAction/View/Spacer`,
  `Stack.Title`, `Stack.Header` — attached in `node_modules/expo-router/build/layouts/StackClient.js`.
- iOS mapping: `.../layouts/stack-utils/toolbar/processHeaderItemsForPlatform.ios.js` → options
  `unstable_headerLeftItems` / `unstable_headerRightItems`; consumed in
  `.../react-navigation/native-stack/views/useHeaderConfigProps.js` (~line 211–275).
- Multiple `Stack.Toolbar`/`Stack.Title` instances from a page merge via the composition registry
  (`.../fork/native-stack/composition-options/`) — `Object.assign` over each instance's options, so
  distinct placements coexist; same key = last one wins.
- Rendering `Stack.Toolbar placement="left"|"right"` forces `headerShown: true`.
- `icon` on Button/Menu accepts a plain SF Symbol string.
- `Stack.Title asChild` with a component child → `headerTitle: () => children`.

## Build/test workflow

- Metro on 8081, sim: iPhone 17 Pro iOS 26.5. Reload JS after edits with argent `restart-app`
  (bundle id `com.markmccoid.laabs-audio`) — `debugger-reload-metro`/Metro `/reload` do NOT work.
- Typecheck: `npx tsc --noEmit -p tsconfig.json` (clean as of handoff).
- Per `CLAUDE.md`: delegate any simulator testing to an Opus agent.

## Phase 2 (not started)

- Wire each segment to real data (library items / collections / playlists) — data layer lives in
  `src/data`, `src/api`, `src/query` (ABS server); follow how Home shelves fetch via
  `@/hooks/abs-data-hooks`.
- Decide real actions for the left filter button and the ellipsis menu (currently no-op
  `console.log` stubs labeled Sort/Filter).
- Reference screenshot also shows per-row cover + title + book count + chevron lists — likely a
  SwiftUI `List` or the repo's existing list patterns.
