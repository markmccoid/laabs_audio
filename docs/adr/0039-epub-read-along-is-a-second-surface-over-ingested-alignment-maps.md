# EPUB Read-Along is a second Read-Along surface over an ingested Alignment Map

Read-Along becomes an umbrella over two surfaces: **Transcript Read-Along**, which shows the words the
narrator said, and **EPUB Read-Along**, which shows the words the book says. The second is driven by an
Alignment Map found as `laabs.<epub-stem>.alignment.json` in the Audiobookshelf item folder
(ADR-0038), ingested into its own shadow-SQLite tables the way ADR-0037 ingests a Book Transcript, and
rendered by `react-native-readium` with each Text Unit located by Quote Anchor.

The map and its EPUB are **library assets**, not download assets — they live independently of Downloaded
Audio Assets and of any Book Transcript, because the Alignment Map's timings do not depend on the
transcript once built. Unlike the transcript, neither is fetched eagerly: the item's `libraryFiles`
answers "is there a map?" for free, and that alone decides whether the surface is offered. The 1.4 MB
map and its ~1.7 MB EPUB are pulled on first open of EPUB Read-Along and kept.

## Considered Options

- **One Read-Along that swaps its data source.** Rejected as a domain claim: the glossary defined
  Read-Along as displaying a *Book Transcript*, and the two surfaces differ in substrate, addressing
  (Quote Anchor vs. Transcript Segment index), renderer (WKWebView vs. FlashList) and failure modes.
  They still share one route and one screen — see Consequences — but they are two named things.
- **Keep the Alignment Map as JSON on disk and parse a Resource at a time.** Rejected: the playback loop
  binary-searches `startMs` across the whole book, and consumer obligation 2 requires per-unit state
  keyed on `(epub.sha256, extractorVersion, i)`. SQLite gives both an index and a foreign key, and
  repeats a pattern that just worked for transcripts. ADR-0037's deferred compression question is
  inherited, not reopened.
- **Ingest the map eagerly on book-detail mount, as the transcript does.** Rejected: the transcript is
  eager because it feeds clip text, which is reachable without ever opening Read-Along. Nothing outside
  EPUB Read-Along consumes an Alignment Map.
- **Tie the EPUB's lifetime to the audio download.** Rejected for ADR-0037's reason verbatim — it would
  make reading while streaming impossible.

## Consequences

- The two surfaces share one route and one screen, selected by a control at the top of it, and therefore
  share the position, Follow Mode and keep-awake plumbing. `useReadAlongPosition` gains an optional
  `leadMs` and otherwise drives Text Units unchanged, since a Text Unit is the same `{startMs, endMs}`
  shape a Transcript Segment is.
- EPUB Read-Along is iOS-only. `plugins/with-readium.js` wires the iOS Podfile alone, and the measured
  decoration cost model is a WKWebView number that says nothing about Android's WebView.
- v1 highlights and turns Resources, and does nothing else. Tap-to-seek back into the audio and
  keeping the highlight on screen *within* a long Resource both require comparing Readium's
  `progression` — a rendered-pixel ratio — against the map's `g`, a character ratio. Those are different
  quantities, so both wait on the same passive `(g, progression)` calibration and ship together or not
  at all. **Superseded — see Amendment 1.**
- Selection-to-clip is not offered here. On iOS `onSelectionChange` never fires, and the only
  alternative — a custom `selectionActions` entry — makes Readium drop `EditingAction.defaultActions`
  and replace the system Copy / Look Up menu wholesale. Transcript Read-Along already makes clips
  (ADR-0035).
- Decorations are cleared by sending a group with an empty decoration list, never by omitting the group;
  the native `updateDecorations` only iterates groups present in the incoming array. The same property
  is what lets a narrow, frequently-updated group and a wide, rarely-updated one coexist without either
  repaying the other's cost.

---

## Amendment 1 — tap-to-seek does not need the calibration (2026-09-07)

The third consequence above bundled two features on the grounds that both must compare `progression`
against `g`. That was true of the approach in view at the time and false of the problem.

**Tap-to-seek never has to make that comparison.** Two routes were built. The first used
`onDecorationActivated`, which returns the tapped decoration's own id — the unit index outright, with
no ratio in the loop at all. It worked, but it could only offer taps where decorations had been
painted, and painting the whole book is barred by the cost model and by not wanting our markup over
the publisher's page. The second, which shipped, resolves the tap *inside the document* with
`caretRangeFromPoint` and returns a **character offset**. A Text Unit's `g` is a character ratio by
definition, so that comparison is like-for-like — the one place in this feature where `g` is the right
shape, and it needs no calibration because nothing is being converted between quantities.

**Keeping the highlight on screen within a long Resource is unaffected** and still wants the
calibration. The two were never one item; bundling them was the error.

This amendment changes no decision in the ADR — the surface, the addressing and the ingest are all
unchanged. It corrects a consequence that stated a constraint more broadly than the evidence
supported. The remaining consequences stand, including that selection-to-clip is not offered here.

It costs a patch to `react-native-readium`, which the ADR did not contemplate: the binding leaves
`didTapAt` on the protocol's default no-op, so taps reached nothing. See
[react-native-readium-ios.md](../react-native-readium-ios.md).
