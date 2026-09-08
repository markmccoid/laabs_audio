# EPUB Read-Along — how it works

**Status:** built and running behind the surface picker; not released. ·
**Decisions:** [ADR-0038](./adr/0038-alignment-maps-are-paired-by-enumeration-not-by-name.md),
[ADR-0039](./adr/0039-epub-read-along-is-a-second-surface-over-ingested-alignment-maps.md) ·
**Plan and phase status:** [epub-read-along-implementation-plan.md](./epub-read-along-implementation-plan.md)

Read-Along is an umbrella over two surfaces. **Transcript Read-Along** shows the words the narrator
said; **EPUB Read-Along** shows the words the book says, highlighting each sentence as the narration
reaches it. This document is the second one: what exists, what was learned the hard way, and what is
still open.

**Producer contracts live in another repo and are the authority — read them, do not restate them:**
`/Users/markmccoid/Documents/myProgramming/MacOS/LAABS Audio Align/docs/contracts/alignment-map.md`
and `docs/DECISIONS.md` in the same repo (D4, D8, D21, D46, D47).

---

## The module map

Ingest — server file to SQLite. Mirrors `src/transcription/` deliberately, module for module.

| Module | Job |
| --- | --- |
| `src/components/bookComponents/alignment-files.ts` | Enumerate `laabs.*.alignment.json` from `libraryFiles`; tolerant stem match against `collectEbookFiles`; `hasAlignmentLibraryFile` is the free presence check that decides whether the surface is offered at all. |
| `src/alignment/alignment-artifact.ts` | Parse and validate `formatVersion: 1`, `kind: "alignment"`. |
| `src/alignment/alignment-ingest-plan.ts` | Pure: collision decision, pairing check, Book Time recompute. |
| `src/alignment/alignment-ingest.ts` | Fetch by ino → plan → write. Resolves with `failed`; never rejects. |
| `src/data/sqlite/shadow-db-alignment.ts` | `alignment_maps` / `alignment_resources` / `alignment_units`, indexed on `(library_item_id, start_ms)`. |
| `src/alignment/use-alignment-ingest.ts` | Gated on `enabled`, so nothing is fetched until the reader opens. |
| `src/alignment/epub-asset.ts` | The durable EPUB download. A **second** path beside `downloadsApi.downloadEbook`, which fetches to cache and deletes in a `finally`. |

Reader.

| Module | Job |
| --- | --- |
| `src/alignment/alignment-decorations.ts` | Pure: resolve the target, decide a resource turn, build the decoration, classify who moved the page. Where the measured constants live. |
| `src/components/read-along/epub-read-along-view.tsx` | The paint/scroll loop and the `ReadiumView` host. |
| `src/components/read-along/epub-read-along-surface.tsx` | Ingest → EPUB fetch → the honest states when either fails. |
| `src/components/read-along/read-along-surface-picker.tsx` | The *Transcript | Book* control, plus `initialReadAlongSurface`. |
| `src/read-along/use-read-along-position.ts` | Shared by both surfaces. Gained `leadMs`. |

The reader loop is four steps, three of them pure and unit-tested:

1. `useReadAlongPosition` resolves the active **timed** unit, looking `leadMs` ahead.
2. `resolveReaderTarget` turns the search-array index into a spine href.
3. `goTo` — on a resource turn, and again per sentence while Follow Mode is on.
4. One decoration group, one decoration, re-sent on every move.

---

## Facts earned on device — do not re-derive these

### The decoration cost model (E8 / Align D47)

Stopwatch, physical iPhone 16. `t ≈ 0.4 s + 0.018 s × N`, and **the fixed cost is paid per group**:
a 1-decoration group re-applies in ~0.4 s while a 20-decoration group sits beside it untouched and
does not repaint. That is what makes a moving highlight viable at all.

An earlier measurement (E5) gave `0.6 s + 0.12 s × N` on the same phone — roughly seven times more
per decoration. **The discrepancy is unexplained.** Every E8 number is better and the architecture
rests on the N=1 reading, which is the easiest of the set to time accurately, so nothing blocks on
it. Do not re-measure with the RN frame counter: the anchoring runs inside WKWebView's own JS
context and the device reports a flat 60 fps at every N.

Because the cost is deterministic latency rather than jank, the active decoration is **pre-fired**
`DEFAULT_ACTIVE_LEAD_MS` (400 ms) before the unit's `startMs`, which makes the delay invisible
rather than merely short. `interpolatePosition` multiplies elapsed wall time by `rate`, so the
look-ahead is automatically `leadMs × rate` in book time and stays correct at 2×. **The lead should
be calibrated on the device**; one tuned on an iPhone 16 fires late on slower hardware, which is
worse than not pre-firing.

### `goTo` resolves the quote

A `Locator` carrying `text.highlight` scrolls to **that exact sentence**, not near it — verified
against six quoted sentences over a 90 s untouched window. This is what makes in-chapter Follow Mode
possible without the `(g, progression)` calibration, and it is why `toFollowLocator` carries the
quote while `toResourceLocator` carries only progression.

### `goTo` acknowledgement timings

Measured gaps between issuing a `goTo` and the resulting `onLocationChange`:

| Operation | Observed | Window |
| --- | --- | --- |
| Scroll within the rendered document | 1.035, 1.175, 1.396, 1.444 s | `FOLLOW_ACK_WINDOW_MS` = 2000 |
| Turn to another document | 2.514, 2.676 s | `TURN_ACK_WINDOW_MS` = 6000 |

Two operations, two profiles. A single window has to be wide enough for the slower one, and every
millisecond of it is time in which a hand scroll is mistaken for our own `goTo`. Splitting them is
what keeps the frequent case tight.

### At mount, Readium reports a document you never asked for

It emits its own initial location — `cover.xhtml` on a real book — **after** the first `goTo`. Read
as a reader scroll, that killed Follow Mode on three mounts out of three. Hence
`hasAcknowledgedRef`: nothing is attributed to the reader until Readium has acknowledged a `goTo` of
ours.

### Binding gaps and capabilities (`react-native-readium` 5.1.1, iOS)

- **Decorations are never removed by omission.** `updateDecorations` iterates only the groups present
  in the incoming array, so a group dropped from the prop stays painted. Clear by sending the group
  with an empty decoration list (D21). This is also a *capability*: it is why two groups can be moved
  independently.
- **`onSelectionChange` never fires on iOS.** Declared in `HybridReadiumView.swift`; only the Android
  implementation invokes it. A selection reaches JS only through a custom `selectionActions` entry
  plus `onSelectionAction`, and supplying any custom action makes `EPUBViewController` drop
  `EditingAction.defaultActions`, replacing the system Copy / Look Up menu wholesale.
- **`onDecorationActivated` *does* fire on iOS.** `updateDecorations` registers
  `observeDecorationInteractions(inGroup:)` for every group. The event carries the decoration (so our
  `laabs-u{N}` id identifies the unit exactly), its group, and the tap rect. `extras` round-trips
  through `userInfo`. **This is the viable route to tap-to-seek** — see Open below.
- **Only `highlight` and `underline` styles exist.** `DecorationData.toDecorationStyle` has
  `// TODO: Add support for custom styles` and returns nil for anything else, which silently drops
  the decoration. There is no custom HTML/CSS decoration.
- **Tints accept 8-digit hex as ARGB**, so `#00FFD54F` is fully transparent. `rgba()` is parsed too.
  An invisible-but-tappable decoration is therefore possible.
- **`onLocationChange` returns an empty `text`.** It says which document is on screen and nothing
  about what text is.
- **`ready` has been seen firing twice**, and a remount drops every painted decoration silently. The
  view re-applies whatever it holds on every `onPublicationReady`.
- **Swipes starting inside the reader panel are swallowed by the WebView** and turn pages. Controls
  belong at the top, or well clear of it.

### The artifact is not shaped like its own example

Found by parsing both real maps rather than trusting the contract's sample:

- **A Text Unit may carry no timing at all** — 1,416 of 4,723 in *A Field Guide to Lies*, 83 of 3,238
  in *Seven Tensions*. Modelled as `timing: null`, one nullable group rather than five nullable
  fields.
- **`p` cannot identify those units.** Every untimed unit reports `p: "i"`, and so does every
  genuinely interpolated one. **The presence of a timing is the only honest discriminator** —
  `getTimedAlignmentUnits` filters on `start_ms IS NOT NULL` for exactly this reason. A reader that
  filters on provenance will light up sentences it has no time for.
- **Resources never carry `title`**, and those with no timed units carry no `trackIndex`/`startMs`
  either. Some hold zero units.
- **`libraryFiles` can name a file that is not there.** Observed on this project's own server: after
  `align` renamed a map, the pre-rescan listing still advertised the old name and its download 404'd.
  The presence check reads that listing, so it can offer a map that cannot be fetched.
- **`epub.sha256` is not verifiable on device** — that would mean hashing the whole EPUB, the thing
  ADR-0038 avoided. Ingest verifies `derivedFrom.epub.ino` instead, which is weaker (D36: an ino
  changes on re-import), records the sha256, and treats a mismatch as a dismissible notice.

---

## Reading the logs

Everything below is deliberate and should stay until the open issues are closed.

| Line | Means |
| --- | --- |
| `[AlignmentMap] ingest start book=… file=…` | Ingest began; the map was paired with an ebook. |
| `[AlignmentMap] parsed book=… units=N resources=M` | The artifact parsed. |
| `[AlignmentMap] writing / wrote book=…` | The SQLite write. A missing `wrote` means it hung or threw. |
| `[AlignmentMap] ingest failed …` | Resolved failure — includes the stale-listing 404. |
| `[AlignmentMap] ingest threw …` | A rejection escaped, which is a bug in ingest itself. |
| `[EpubReadAlong] map loaded book=… timedUnits=N resources=M` | The reader read the map out of SQLite. |
| `[EpubReadAlong] resource turn -> href unit=N` | Navigating to another spine document. |
| `[EpubReadAlong] follow -> unit=N href` | Scrolling to keep the narrated sentence in view. |
| `[EpubReadAlong] follow off — reader scrolled to href` | Follow Mode yielded to a hand scroll. **With no touch, this is a bug.** |
| `[EpubReadAlong] no active unit — unaligned stretch` | Correct silence: narration with no matching text. Indistinguishable from a stall without this line. |
| `[ReadAlong] ticker running/idle lead=N …` | The 150 ms position ticker. `lead=0` is Transcript, `lead=400` is EPUB. `idle` names which gate stopped it. |
| `[ReadAlong] segment lead=N index=X pos=Yms of=Z` | The active segment index changed. |

**How to read them for a frozen highlight:** if `ticker running` is present but no `segment` lines
appear while audio advances, the index is stuck and `pos` says whether the interpolated clock
stopped. If `segment` lines *do* advance and the screen does not, the bug is in rendering.

---

## Testing it

Two books on the dev server carry an Alignment Map, and they differ usefully:

| Book | libraryItemId | Matched | Untimed | hrefs |
| --- | --- | --- | --- | --- |
| The Seven Tensions of Negotiation | `83f829b9-1434-41a0-8acf-d6079e97b5fd` | 95.9% | 83 (2.6%) | `OPS/…` |
| A Field Guide to Lies and Statistics | `87c842fa-8530-4082-b45e-9034c9192f04` | 66.7% | 1,416 (30%) | `OEBPS/…`, and one bare `titlepage.xhtml` |

Use Seven Tensions to judge whether highlighting is correct. Use Field Guide as the adversarial case:
its long untimed stretches must produce **no** highlight, and a previous highlight left lit through
one is the "never removed by omission" bug returning.

**The highlight only moves while the player is on the same book** — `useReadAlongPosition` refuses to
interpret another book's position. Play the book first, then open the reader.

Both real maps are parsed by the test suite from the sibling Mac checkout's `artifacts/` directory,
so `npx jest src/alignment` exercises 4,723 and 3,238 real units rather than a fixture that would
only ever agree with the parser.

There is no EPUB dev harness any more — the surface picker in Read-Along is the way in. Play the
book, open Read-Along from the main player, and switch to **Book**.

**The Readium anchor spike is deliberately still there**, at Settings → Developer → *Readium Anchor
Spike*. Its stated deletion trigger ("once the Alignment Map format is frozen") has passed, and it
is kept for two jobs this reader cannot do: verifying that **decoration taps reach JS** — the
unproven half of tap-to-seek, below — and **re-measuring decoration cost on other hardware**, since
`DEFAULT_ACTIVE_LEAD_MS` is an iPhone 16 number. Delete it, `src/spikes/readium-anchor`, and the
whole Developer group once tap-to-seek is verified.

Note it is **untracked in git**, so deleting it is permanent.

---

## Open

**Under investigation, diagnostics in place:**

- **The transcript highlight freezes after switching Book → Transcript**, while audio advances. Seen
  once, not reproduced. The ticker was confirmed *running* at the time, so it is not the focus gate;
  the `[ReadAlong] segment` line was added to separate a stuck index from a stuck render.
- **Transient double highlight in the EPUB.** Bounded and self-draining — eight were seen at once
  during a fast bullet list, draining back to two then one — but a steady state of two is common.
  Removal happens inside Readium's own `navigator.apply(decorations:in:)` pipeline, so it is not
  fixable by changing what we send; applying less often is the available lever.
- **The same unit's `follow -> goTo` sometimes fires twice** (e.g. `unit=2615` at 02:56:36.9 and
  02:56:38.3). Redundant, and a plausible contributor to the double highlight.

**Known and accepted for now:**

- **A hand scroll within the pre-acknowledgement window is swallowed** — roughly a third of the
  timeline. Inherent without a touch signal, which the binding does not expose. Only narrowable.
- **The highlighted sentence lands flush against the top edge** with no lead-in context. Readium
  controls that placement.
- **Producer defect:** some quotes span block boundaries with no separator, e.g.
  `…seven tensions.Comparative BATNAAnyone who has had any training…`, so one "sentence" highlights a
  heading plus two paragraphs. The Mac extractor, not the reader.

**Not built:**

- **Tap-to-seek.** The route is `onDecorationActivated` over a window of tappable decorations — it
  returns the exact unit index and sidesteps the `(g, progression)` category error that caused the
  original deferral. Cost is `0.4 + 0.018N` per apply, so it must be a window, not a whole chapter
  (400 units would be 7.6 s). A faint tint doubles as an honest signal of which text is aligned.
  **Unverified: whether decoration taps actually fire.** That is the first thing to check, and the
  Readium anchor spike screen is the cheapest place to check it — which is why it has not been
  deleted.
- The empty state's secondary action ("Read the book instead") — `EmptyStateBody` supports exactly
  one action today.
- The download sheet's Transcript card is hard-gated on `isDownloaded`, so it is invisible on a
  streamed book even when an Ingested Book Transcript exists. That contradicts ADR-0037 and is a
  defect independent of this feature.
