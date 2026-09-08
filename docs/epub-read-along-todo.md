# EPUB Read-Along — the follow-on work

**Status:** appearance shipped; tap-to-seek in progress. · **The system:**
[epub-read-along.md](./epub-read-along.md) · **v1's plan:**
[epub-read-along-implementation-plan.md](./epub-read-along-implementation-plan.md) — that file's
"Phase N" numbering is v1's and unrelated to the stages here.

v1 highlights the narrated sentence and turns Resources, and does nothing else. This is the list of
what comes after it, in the order the reader asked for, with the decisions already taken written down
so they are not re-litigated.

---

## What changed, and why — 2026-09-06/07

Every file this round touched, and the reason. Detail lives in the linked docs; this is the map.

### New behaviour

| Change | Why |
|---|---|
| `epub-reading-preferences.ts`, `read-along-appearance-book.tsx`, `isBookSurface` on `ReadAlongHeader` | Items 1 & 2. The `Aa` popover was showing the transcript's rows on the Book surface, where the app draws none of the text, so none of them did anything. |
| Seven `readAlongEpub*` keys in `settings-store.ts` | The Book surface's appearance. Added without a version bump — each has a normalizer that turns an absent value into the default, the pattern `readAlongWordHighlightStyle` already set. |
| `useIsDarkTheme` extracted in `use-app-theme.ts` | The reader's Auto theme needs the *resolved* light/dark, and the app's own setting can be `"system"`. `useEbookAccentColor` was doing this inline and now shares it. |
| `ActiveDecorationStyle` on `alignment-decorations.ts` | Sentence highlight became Highlight / Underline / None. Defaulted, so every existing caller is unchanged. |
| `alignment-tap-point.ts` | Item 3. Resolves a tap to a Text Unit by character ratio. |
| `patches/react-native-readium+5.1.1.patch` | The binding reported no taps at all — see below. |
| `queueGroups` / `appliedGroupsRef` in `EpubReadAlongView` | Readium *applies* the groups in the `decorations` prop rather than diffing them, so sending an unchanged group repays its full cost. Now sends only what changed. |

### Deleted

| Removed | Why |
|---|---|
| `alignment-tap-window.ts` + tests (29) | Tap-to-seek's first implementation. Superseded — it could only offer taps where decorations had been painted. Kept nothing: two mechanisms for one gesture would mean two ways for a tap to be read. |

### Corrected

| Document | What was wrong |
|---|---|
| ADR-0039, Amendment 1 | Bundled tap-to-seek with in-Resource scroll-following on the grounds that both need the `(g, progression)` calibration. Tap-to-seek never needed it. Amended rather than rewritten — the decision stands, one consequence overreached. |
| `CONTEXT.md` rules | Said EPUB Read-Along "does not otherwise scroll itself", which was **already false before this work** — following within a Resource shipped in v1. Corrected, plus new rules for tap-to-seek and for the two surfaces keeping separate appearance settings. |
| v1 implementation plan | Its "Deferred" section still held tap-to-seek behind the calibration. |
| Spike screen header | Claimed nothing had exercised `onDecorationActivated`. E9 now does. |

### Found along the way, not caused by this work

- **E5's `Collect` can scope to the wrong chapter.** Its book-wide search cap fills in document order, so a common query never reaches the visible chapter and it silently falls back to "largest resource" — every downstream experiment then decorates a chapter nobody can see. Documented above `collectBulkQuotes`.
- **Readium decorations are invisible to accessibility.** No screen-space frames, no accessibility elements. There is no supported way to tap one from the accessibility tree.
- **`pod install` needs `LANG=en_US.UTF-8`** from a non-interactive shell, or it dies on a non-ASCII byte in an unrelated dependency and blames that dependency.
- **`src/player/player-service.ts` has 17 diagnostic lines** added by neither of the above and not by this work — position-tick guard logging for the Read-Along frozen-highlight bug. Left in place; ownership unconfirmed.

---

## The five items

| # | Item | Stage | Status |
|---|---|---|---|
| 1 | The `Aa` menu does nothing on the Book surface | Appearance | **Done** |
| 2 | Font size should affect the EPUB | Appearance | **Done** |
| 3 | Move forward/backward within a chapter | Tap-to-seek | **Rebuilt on a binding patch, untested on device** |
| 4 | Saved clips shown as highlights or underlines | Clip marks | Not started |
| 5 | Create clips from selected text | — | **Deferred** |

---

## Decisions taken

Each of these closed a real fork. They are recorded because the reasons are not recoverable from the
code.

- **Item 3 means tapping a paragraph to seek the narration there** — not page navigation, and not
  prev/next-sentence buttons. Both alternatives were on the table; the tap won.
- **Item 5 is deferred.** ADR-0039's "Selection-to-clip is not offered here" stands unamended. The
  blocker is unchanged: `onSelectionChange` is dead on iOS, and the only alternative — a custom
  `selectionActions` entry — makes `EPUBViewController` drop `EditingAction.defaultActions` and
  replace the system Copy / Look Up / Translate menu wholesale. Getting both would mean patching the
  binding. Transcript Read-Along keeps making clips (ADR-0035).
- **The `Aa` popover exposes the full Readium preference set**, not a minimal one.
- **Clip marks are the reader's choice** — Highlight / Underline / Off, as a row in that popover. The
  row ships with the decorations it drives, not before: a control that does nothing is the bug item 1
  exists to fix.
- **Two font-size settings, not one.** See "Reading appearance is Readium's, not ours" in
  [epub-read-along.md](./epub-read-along.md).

---

## Stage: the gate — closed

Item 3 rested on one untested callback: does `onDecorationActivated` fire? **It does.** Verified by
E9 in the Readium anchor spike — see "Decoration taps reach JS (E9)" in
[epub-read-along.md](./epub-read-along.md) for the four cases and their evidence.

This also **supersedes the deferral recorded in v1's plan**, which held tap-to-seek behind a passive
`(g, progression)` calibration. Decoration activation returns the unit index outright, so the two
quantities never have to be compared. The calibration is still owed for *scroll* position, but no
longer blocks this.

Two things E9 did not settle: physical hardware (simulator only), and the tint — E9's targets were
word-width, because E5's quotes come from single-word search hits, and tap-to-seek paints a
continuous band under every sentence. Those look nothing alike at density.

## Stage: appearance — done

Items 1 and 2. `ReadAlongBookAppearance` replaces the transcript's rows when the Book surface is
showing; `epub-reading-preferences.ts` holds the whole mapping, pure and tested. What Readium will and
will not honour, and why each control is shaped the way it is, is documented in
[epub-read-along.md](./epub-read-along.md).

Not yet exercised on a device. Worth checking: that the theme flips, that Publisher typography off
visibly changes line spacing, and that Sentence highlight → Underline reads well against the page.

## Stage: resource window — superseded

Built as a shared module for items 3 and 4, then deleted when tap-to-seek stopped using decorations.
Clip marks still need the time-to-unit half, which is a few lines against `getResourceUnits`; the
loading of a resource's units survives in `EpubReadAlongView` and is what tap matching reads.

## Stage: tap-to-seek — rebuilt on a binding patch, untested on device

**Superseded the decoration approach entirely.** First device impressions were that only the tinted
text could be tapped, and that this was not free movement. Both halves were fair, and they were two
different problems:

- **The tint was cosmetic.** Taps arrived through `onDecorationActivated`, which fires where a
  *decoration* is; the tint was only how that decoration looked.
- **Coverage was the real limiter.** The window was anchored to the narration, so scrolling away left
  the reader outside it with nothing tappable, whatever the colour. Anchoring it to the reader's own
  scroll position fixed that — but it was still a window, and still markup over the publisher's page.

Decorating the whole EPUB was ruled out, so the decoration route had a ceiling it could not clear. It
is now replaced by a **patch to `react-native-readium`** adding an `onTap` event that resolves the tap
inside the document with `caretRangeFromPoint` — unbounded, no decorations, no tint, and it closes
four open questions at once (window radius, edge margin, tint contrast, and whether a transparent
decoration is tappable).

`alignment-tap-window.ts` and its tests are deleted; `alignment-tap-point.ts` replaces them. How and
why is in [epub-read-along.md](./epub-read-along.md) under "Tap-to-seek"; the patch itself is
documented in [react-native-readium-ios.md](./react-native-readium-ios.md).

**Requires a native rebuild** — `pod install` then a full build, because the patch adds eight
generated files. The `react-native-readium` pod target compiles clean against the patch (verified:
`** BUILD SUCCEEDED **`, no errors, no new warnings), so what remains is runtime behaviour, not
whether it builds.

Open, to be settled on a device:

- **Whether taps land on the right sentence.** The character-ratio match is approximate: the DOM
  counts whitespace and markup the extractor dropped. `TAP_MATCH_TOLERANCE` (0.05 of the resource) is
  a starting point.
- **Whether the tap listener interferes with Readium's own gestures.** It is passive and never calls
  `preventDefault`, so it should not — but scrolling, page turns and text selection all want checking.
- **Whether the `didTapAt` / DOM `click` race is really covered** by the retry-and-discard-stale read.

Built in: **a tap resumes Follow Mode.** A deliberate "put me here" is the clearest possible
statement that the reader wants to be followed again. A tap while the player is on another book does
nothing, as there is nowhere to seek to. A tap on text the map does not cover resolves to nothing and
says so in the log.

### Now moot

Spike case **9e** (is a transparent decoration tappable?) was asked to decide whether tap-to-seek had
to tint the page. It no longer does, so 9e is unnecessary unless clip marks turn out to want it.

## Stage: clip marks — not started

Clips are time ranges and units carry `startMs`/`endMs`, so this needs no text matching — pure
overlap, painted on resource turn into its own group. If activation holds, a tapped mark opens its
clip.

Known cosmetic cost: one decoration per unit means a multi-sentence clip shows faint seams between
adjacent sentences under Highlight. Underline hides them, which is part of why that option exists.
