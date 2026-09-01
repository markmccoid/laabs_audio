# Read-Along v1 — Implementation Plan

Status: approved design, ready to build. Builds on the Book Transcript v1 feature (branch `feature/book-transcripts`, see `docs/book-transcript-implementation-plan.md`).
Design authority: `CONTEXT.md` (terms: **Read-Along**, **Follow Mode**, **Book Transcript**, **Transcript Segment**, plus the Read-Along relationship rules) . If this plan and that file disagree, that file wins.

## What v1 is

A full-screen reading view, launched from the main player, that displays the playing book's Book Transcript and highlights the current Transcript Segment and current word in sync with the Listening Position. Works on partially transcribed books (completed sections readable, pending sections shown as pending).

Settled decisions (do not relitigate):

| Decision | Choice |
|---|---|
| Entry | A 5th `ActionIconButton` on the main player's actions bar (SF Symbol `text.book.closed` or `captions.bubble`), **always visible**. With a transcript (complete or partial): opens Read-Along. Without: opens a lightweight state screen pitching the feature with a Generate Transcript action (routes to the existing `book-transcribe` start sheet) — also the status surface while a transcription runs. |
| Presentation | Full-screen view (its own route, card-style like `main-player`), pushed above the player. |
| Book binding | Bound to the book it opened for. If the loaded book changes while open: un-highlight, quiet notice "Now playing a different book" with **Switch** (if that book has a transcript) / **Close**. Never auto-switch or auto-dismiss. |
| Highlight | Hybrid: current segment = soft accent-tinted rounded background block with gentle cross-fade; current word = **one of four user-selectable treatments** within it (see "v1.1 — Highlight styles" below). Past/future text plain `text` color, future NOT dimmed. Segments with null word timings degrade to segment tint only. |
| Position sync | Client-side interpolation between the existing 1 Hz ticks: anchor `(positionMs, wallClock)` on each store update, display position = anchor + elapsed × `rate` while `playbackState === "playing"`. Active only while the view is mounted. Do NOT change the global progress interval. |
| Follow Mode | Auto-scrolls to keep the active segment ~40% from the top. Pauses on user-initiated scroll; a "Resume following" pill re-enables it. No auto-resume timer. |
| Tap-to-seek | Tapping a segment seeks playback to that segment's `start_ms` (segment-level only, no word-level seek). |
| Chapter navigation | A chapters button in the Read-Along header opens the existing `chapter-viewer` sheet; its seek moves audio and (via Follow Mode) text. No new picker UI. |
| Partial transcripts | Sections below the transcription frontier are readable; sections beyond it render a pending block ("Transcribing this chapter…" with live progress when it's the active transcription; "Resume transcription" action when the transcription is resumable/cancelled). |
| Controls | Minimal overlay: play/pause + skip back/forward (reusing the player's configured skip seconds). Reader never has to leave the view. |
| Comfort | Adjustable font size persisted in settings (net-new preference); screen kept awake while the view is open (`expo-keep-awake` added as a direct dependency); theme from existing `useThemeColors` tokens only. |
| Platform | iOS-first like the transcript feature; the view itself is plain RN and needs no platform gate beyond "a transcript exists" (transcripts only exist on iOS 26+ devices anyway). |


## v1.1 — Highlight styles

The v1 word treatment was accent colour + `fontWeight: "600"`. Bolding changes glyph
metrics, so the line reflowed every time the highlight advanced — distracting at
2-4 words a second. The treatment is now a preference with four choices; the three
new ones all leave metrics untouched.

| Style | Word treatment |
|---|---|
| `highlight` (default) | Accent background bar at `WORD_HIGHLIGHT_ALPHA` (0.32), text colour unchanged — the bar carries the signal rather than competing with it. |
| `color` | Accent colour only, weight unchanged. |
| `bold` | The original v1 treatment, kept as a choice. The only one that reflows. |
| `none` | No word treatment; the segment block alone tracks position. |

Settled decisions:

- **Word only.** The segment's accent block and its 220ms cross-fade are unchanged in
  all four styles, `none` included — hence the heading "Word highlight" in the UI.
- **No animation on the word.** It snaps. A fade at word cadence leaves two words
  half-lit and reads as lag; the segment tint keeps its fade.
- **Square bars, by constraint.** React Native cannot give a nested `<Text>` span
  padding or rounded corners, so the `highlight` bar is a sharp rectangle as tall as
  the line height. Rounded pills would need measured word rects behind the text —
  rejected as fragile under re-wrap and font-size changes. If the bar reads as too
  chunky, lower `LINE_HEIGHT_RATIO` for that style before reaching for measurement.
- **One alpha for both themes**, matching `ACTIVE_TINT_ALPHA`'s precedent. If dark
  mode reads washed out, split `WORD_HIGHLIGHT_ALPHA` per theme — the reader already
  has `useColorScheme()` in its footer.
- **`none` short-circuits the machinery.** `useReadAlongHighlight` takes
  `isWordHighlightEnabled`; when false it never fetches `words_json` and withholds
  timings from the position hook, so the reader re-renders at segment rate (~1 per
  sentence) instead of word rate. Switching back resumes at the next segment
  boundary, not mid-sentence — accepted rather than adding a re-fetch effect.
- **Persisted globally** as `readAlongWordHighlightStyle`, alongside
  `readAlongFontSize`. **No settings-store version bump**: a new key is absent from
  every persisted blob and zustand's shallow merge resolves that to the initial-state
  default. It still has to appear in both of `migrate`'s exhaustive returns to
  typecheck against `partialize`.
- **Selector lives in the reader's `Aa` popover**, which becomes a two-section
  appearance card (Text size / Word highlight). Nothing in global Settings — an
  appearance preference belongs where you can see its effect, as font size already
  established. Each style row renders a sample word in its own style, so the labels
  never have to describe the look.

Code: `resolveWordHighlightStyle` + `normalizeReadAlongWordHighlightStyle` in
`src/read-along/read-along-rendering.ts` (pure, unit-tested); the resolved appearance
rides inside the memoized `palette` object so
`read-along-segment-item.tsx`'s comparator contract needs no new branch.

## Existing code to reuse (verified paths)

- **Player screen & actions bar**: `src/app/main-player.tsx` → `src/components/main-player/main-player-screen.tsx`; the actions bar is `src/components/main-player/main-player-actions-bar.tsx` — `PlayerActionsFrame` row (~line 260) with four `ActionIconButton`s (~line 352-401); `ActionIconButton` (~line 43) takes `icon`, `label`, `onPress`, `badgeCount`, `isActive`. Note `minWidth: 70` per button — five buttons need width tuning.
- **Route registration**: `main-player` is registered in `src/app/_layout.tsx:658-670` (`presentation: "card"`, `headerShown: false`, vertical gesture) — mirror that for the new route. New root routes must also be added to `RESERVED_ROOT_SEGMENTS` in `src/navigation/book-links.ts:39-56` and the route gate in `src/navigation/authenticated-route-state.ts:30-71` (unknown segments get sent Home).
- **Chapter viewer** (`src/app/chapter-viewer.tsx`): the tap-to-seek pattern to copy (~line 130-153): load book if not active → `playerService.seekTo(chapter.startMs)` → re-pause if it wasn't playing, with a `pending` guard against double taps. Its one-shot `scrollToIndex` (~line 109-128) is NOT the follow model — Follow Mode is continuous (new code). Opened via `router.push({ pathname: "/chapter-viewer", params: { libraryItemId } })`.
- **Seeking**: `playerService.seekTo(positionMs, options?)` at `src/player/player-service.ts:3254` — book-absolute ms, cross-track safe (resolves target track, loads it if needed). `skipBy(seconds, goBackwards)` for the ± buttons. `import { playerService } from "@/player"`.
- **Playback store** (`src/player/playback-store.ts`): `positionMs` (book-absolute), `rate`, `playbackState` (`idle|playing|paused|ended|error`), `libraryItemId`, `chapterIndex`. **No timestamp accompanies position updates today** — Phase 1 adds one. `setPosition` ~line 229, `applyStatusUpdate` ~line 244. Ticks arrive at 1 Hz (`UPDATE_INTERVAL_MS = 1000`, `src/player/audio-engine.ts:82`). Beware: `player-service.ts:3993-3998` early-returns can skip position updates (resume floor / post-preview).
- **Transcript data** (`src/data/sqlite/shadow-db-transcripts.ts`): `TranscriptSegmentRow { id, libraryItemId, sectionIndex, startMs, endMs, text, words }`, `TranscriptSegmentWordTiming = [startMs, endMs, word]`. Existing readers load whole books incl. `words_json` (`getSegmentsForExport` ~line 336) — too heavy for the view; Phase 1 adds lean queries. Sections: `getTranscriptSections` (frozen `sections_json`). Track completion (the frontier source): `book_transcript_tracks` rows carry `start_offset_ms`, `duration_ms`, `status`.
- **Transcript status/UI state**: `getBookTranscriptUiStatus(libraryItemId)` in `src/transcription/book-transcription.ts` (`idle|resumable|active|complete|failed`); runtime progress via `src/store/transcription-store.ts` hooks (`useActiveTranscriptionTask` etc.); `resumeIfNeeded` for the pending block's Resume action; the start sheet route is `book-transcribe` (params `{ libraryItemId }`).
- **Settings store** (`src/store/settings-store.ts`): five-step recipe for a new preference — constant+clamp helper near top, field on `SettingsState` (~line 158), setter in `actions`, add to `partialize` (~line 573), bump `version` (currently 18 → 19) with a `migrate` branch. Consume via `useSettingsStore(s => s.readAlongFontSize)` / `useSettingsActions()`.
- **Lists**: `@shopify/flash-list` 2.0.2 is the house list (used in `chapter-viewer.tsx`, `LibraryContainer.tsx`). Known FlashList v2 quirk: render window can desync from scroll offset on data change — `src/components/Library/LibraryContainer.tsx:116-124` documents the `scrollToIndex({ index: 0, animated: false })` workaround.
- **Animation**: `react-native-reanimated` 4.3.1 + worklets available (cross-fade on the segment tint; heavier UI-thread machinery is NOT required — see Phase 2 rationale).
- **Text/theme**: colors only from `useThemeColors()` (`bg surface text textMuted border accent accentForeground`); inline `style={{ fontSize, color }}` convention (per project memory, set font size via style `fontSize`, never tailwind text-size classes). `COMPACT_TEXT_MAX_FONT_SIZE_MULTIPLIER` in `src/theme/text-scaling.ts` is for compact player text — do not clamp Read-Along body text with it.
- **Keep-awake**: `expo-keep-awake` is only a transitive dep today — add it to `package.json` explicitly; `useKeepAwake()` in the screen.

---

## Phase 1 — Data layer + position anchor + setting

1. **Lean segment queries** in `src/data/sqlite/shadow-db-transcripts.ts` (additive only):
   - `getSegmentTextRows(libraryItemId)` → `{ id, sectionIndex, startMs, endMs, text }[]` ordered by `section_index, start_ms` — **excludes `words_json`** so a 150k-word book loads only its text (~hundreds of KB, one query on view mount).
   - `getSegmentWords(segmentId)` → `TranscriptSegmentWordTiming[] | null` — single-row fetch of `words_json`, called lazily for the active segment only (view keeps a small LRU of ~5 parsed entries).
   - `getTranscriptFrontierMs(libraryItemId)` → book-absolute ms up to which transcription is complete: `max(start_offset_ms + duration_ms)` over contiguous completed tracks starting from track_index 0 (a gap in completion caps the frontier at the gap — completed tracks beyond a pending one don't extend it; keep the SQL simple and compute contiguity in TS from the ordered track rows). A section is *readable* iff `section.endMs <= frontierMs` (the final section: `>= frontier` within a 1s tolerance counts complete when transcript status is `complete`).
2. **Position anchor** in `src/player/playback-store.ts`: add `positionUpdatedAtMs: number` (wall clock, `Date.now()`), set alongside `positionMs` in BOTH `setPosition` and `applyStatusUpdate` (only when the update actually carries a position change). Exclude it from `partialize`. This is a two-line-per-site change — do not restructure the update path.
3. **Font-size setting**: `readAlongFontSize` (number, clamp 14–24, default 17) via the five-step settings-store recipe (version 18 → 19 with migrate branch). Setter `setReadAlongFontSize`.
4. Add `expo-keep-awake` to `package.json` dependencies (`npx expo install expo-keep-awake` so the version matches SDK 56).

**Acceptance**: tsc clean; jest green; new pure SQL helpers covered by the same style of coverage as Phase-1-transcripts (or deferred to integration if no db harness — note it); settings migration verified by a unit test if the store has migrate tests, else by manual note.

## Phase 2 — Sync engine (pure logic + hook)

**New**: `src/read-along/read-along-sync.ts` (pure, import-clean) + `src/read-along/use-read-along-position.ts` (hook) + tests.

1. Pure functions (unit-tested, no RN imports):
   - `findActiveSegmentIndex(segments, positionMs)` — binary search over `startMs` (segments sorted; a position past a segment's `endMs` but before the next `startMs` — an ASR gap — resolves to NO active segment, return the gap sentinel, don't stretch highlights across silence).
   - `findActiveWordIndex(words, positionMs)` — binary search over word `startMs`; same gap rule.
   - `interpolatePosition(anchor: { positionMs, anchoredAtMs, rate, isPlaying }, nowMs)` — clamped, returns `positionMs` unchanged when not playing.
2. `useReadAlongPosition(boundLibraryItemId)` hook:
   - Subscribes to the playback store; maintains the anchor from `positionMs`/`positionUpdatedAtMs`/`rate`/`playbackState`.
   - While playing AND the view is focused: a **150 ms `setInterval`** computes the interpolated position and derives `{ activeSegmentIndex, activeWordIndex }`; **setState only when either index changes** — so React re-renders happen at word-boundary frequency (~2–4/s), not tick frequency. (Rationale: word highlighting at ≤150 ms granularity is perceptually smooth for prose; a Reanimated UI-thread clock adds worklet complexity for no visible gain. The segment tint cross-fade uses Reanimated locally in the segment component; the *clock* stays in JS. Do not build a frame-callback loop.)
   - Pauses the interval when `playbackState !== "playing"` or the screen loses focus; re-anchors on every store tick (drift self-corrects every second) and immediately on seek/rate/state changes.
3. Follow controller `useFollowMode(listRef, activeSegmentIndex)`: `followEnabled` state (starts true); on active-segment change while enabled → `scrollToIndex({ index, viewPosition: 0.4, animated: true })` guarded by a `programmaticScroll` ref window; `onScrollBeginDrag` (user gesture — fires only for touch scrolls, not programmatic) → `followEnabled = false`; `resumeFollowing()` re-enables + scrolls immediately. Debounce scrollToIndex to at most one call per 500 ms.

**Acceptance**: unit tests for all three pure functions incl. gap sentinel, exact-boundary, before-first/after-last, paused interpolation; tsc/jest green.

## Phase 3 — The Read-Along screen

**New**: `src/app/read-along.tsx` (route) → `src/components/read-along/read-along-screen.tsx` + child components. Register in `_layout.tsx` mirroring `main-player`'s card options; add `read-along` to `RESERVED_ROOT_SEGMENTS` (`book-links.ts`) and the `authenticated-route-state.ts` gate. Param: `{ libraryItemId }`. Regenerate typed routes as Phase 4-transcripts did (brief expo start).

1. **Data assembly** on mount: `getTranscriptSections` + `getSegmentTextRows` + `getTranscriptFrontierMs` → a FlashList data array of typed items: `{ type: "sectionHeader", title }`, `{ type: "segment", row }`, `{ type: "pendingSection", sectionIndex }` (one per unreadable section), with an index map from segmentIndex → list index for Follow Mode. Re-derive the frontier when the transcription store reports a track completing (subscribe to the runtime store; on frontier advance, swap pending blocks for freshly queried segment rows — apply the FlashList v2 data-change quirk workaround if the render window desyncs).
2. **Rendering**:
   - Section header: chapter title, `textMuted`, sticky not required.
   - Segment item: a `Pressable` `<Text>` block, font size from `readAlongFontSize`, generous line height (~1.5). Active segment: Reanimated cross-fade on an accent-tinted (`accent` at ~12–15% opacity, respect both themes) rounded background; when word timings exist (lazy `getSegmentWords` via the LRU), render the segment as nested `<Text>` spans with the active word in `accent` + `fontWeight: "600"`. **Only the active segment component receives `activeWordIndex`** — memoize segment items on `(row.id, isActive, fontSize)` so word ticks re-render exactly one item.
   - Pending section block: "Transcribing this chapter…" + live `%` when this book is the active transcription (`useActiveTranscriptionTask`), "Waiting for earlier chapters…" when queued behind other tracks of the same run, or a "Resume transcription" button (→ `resumeIfNeeded`) when status is `resumable`. Failed → brief error + Retry.
   - Tap segment → chapter-viewer's seek pattern: `playerService.seekTo(row.startMs)`, double-tap guard, preserve paused state.
3. **Chrome**: header row — close (chevron.down, `router.back()`), book title (compact), chapters button (`router.push("/chapter-viewer", { libraryItemId })`), `Aa` button opening a small popover/sheet with a font-size stepper (14–24, live preview, persists via `setReadAlongFontSize`). Footer overlay — play/pause + skip back/forward via `playerService` (reuse the player's configured seek seconds from settings), translucent background (`expo-blur` is available), floating above the list with safe-area padding. "Resume following" pill floats above the footer when Follow Mode is paused.
4. **Bindings**: `useKeepAwake()` while mounted. Bound-book guard: subscribe to `playbackStore.libraryItemId`; when it differs from the bound id → clear highlight/interpolation, show a slim top notice "Now playing a different book" with **Switch** (only when `getBookTranscriptUiStatus(newId)` is complete/active/resumable — swap the bound id and reload data) and **Close**. When `playbackState` is `idle|ended`: keep the text, controls show play (restarts the bound book via the same load-if-needed path the chapter viewer uses).

**Acceptance**: tsc/jest/lint clean on new files; screen renders with seeded data (see Phase 5's seeding trick) without jank at 5k segments.

## Phase 4 — Entry integration

1. **Actions bar**: add the 5th `ActionIconButton` (icon `text.book.closed`, label "Read Along") to `main-player-actions-bar.tsx`; adjust `minWidth`/spacing so five fit on the smallest supported width (check how the frame lays out; reduce to `minWidth: 56` or make it flex-based — smallest diff that doesn't wrap). `onPress` → `router.push({ pathname: "/read-along", params: { libraryItemId: <loaded book id> } })` always — the route itself decides what to show.
2. **No-transcript state** inside the same route: when `getBookTranscriptUiStatus` is `idle` (or the book isn't downloaded), render the pitch screen: short copy ("Read along with the text as it plays. LAABS can transcribe this audiobook on your device."), a **Generate Transcript** button → `router.push("/book-transcribe", { libraryItemId })` when downloaded (else "Download this book to enable transcription" hint), and the iOS-26 unavailability message when `use-transcription-availability` reports unavailable. When `active`/`resumable`, this state screen shows live progress / Resume (reusing transcription-store hooks) and flips into the reader automatically once the first section becomes readable (frontier > first section end).
3. Font-size + keep-awake already wired in Phase 3; nothing else global.

**Acceptance**: five buttons render correctly on an iPhone-SE-width layout (or the narrowest simulator available); every `getBookTranscriptUiStatus` state reaches a sensible screen; tsc/jest/lint clean.

## Phase 5 — Verification

Per project `CLAUDE.md`: all runtime testing delegated to an Agent with `model: "opus"` using argent (bundle `com.markmccoid.laabs-audio`, Metro 8081, `restart-app` not reload-metro; rebuild NOT needed — this milestone is JS-only except the `expo-keep-awake` install, which DOES require one `npx expo run:ios` rebuild).

- **Unit first**: Phase 2 pure functions; Phase 1 helpers where the harness allows.
- **Seeding trick** (this is how Read-Along is testable on the simulator despite SpeechAnalyzer being unavailable there): write transcript rows directly into the app's SQLite via `xcrun simctl get_app_container booted com.markmccoid.laabs-audio data` + `sqlite3` — a complete transcript for one downloaded book (realistic: thousands of segments with word timings covering the real audio duration, generated by a scratch script from the book's actual track offsets) and a partial one (frontier mid-book) for another. The Phase-6-transcripts report confirms the db is reachable this way.
- Device pass: entry button (with/without transcript), reader opens and highlights advance in sync while audio plays (spot-check the highlighted segment's times against the player position), interpolation smoothness at 1× and 2× rate, follow-scroll + manual-scroll pause + resume pill, tap-to-seek (incl. cross-track segment), chapter-viewer jump, pending block on the partial book, font-size persistence across relaunch, keep-awake (idle timer), different-book notice (start another book from CarPlay-sim or Continue Listening), controls overlay, both themes.
- Perf: with the 5k-segment seed, confirm scrolling stays smooth and word ticks re-render only the active segment (React DevTools highlight or a render counter in dev).
- Regression: main player unchanged for books without transcripts; chapter viewer unaffected.

## Edge cases checklist

- ASR gaps: position between segments (or between words) → no active highlight, no stretching.
- Segment straddling a section boundary (belongs to the section containing its start — already true in data; ensure header insertion doesn't split it).
- Seek far outside the frontier on a partial book → Follow Mode lands on the pending block.
- Book with `words_json` null everywhere (hypothetical) → segment-tint-only mode throughout.
- Rate changes mid-playback re-anchor interpolation; pause freezes the highlight exactly.
- Very long single segment (chapterless single-file books) — text wraps fine; word highlight still works; scrollToIndex to a huge item uses viewPosition 0 (top) fallback if 0.4 misbehaves.
- Transcript deleted (book deleted) while the view is open → store subscription notices, view falls back to the no-transcript state.
- FlashList data swap when the frontier advances (the documented v2 desync quirk).
- Notch/safe areas for header/footer overlays; VoiceOver labels on all new controls.

## Explicitly out of scope for v1

Word-level tap-to-seek, auto-resume of Follow Mode, sepia/custom reading themes, opening Read-Along from book detail, forced alignment against real ebooks, transcript editing/correction, search within the transcript, Android.
