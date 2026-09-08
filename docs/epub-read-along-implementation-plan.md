# EPUB Read-Along — implementation plan

**Status:** Phases 0-2 done; Phase 3 largely built. For how the shipped code behaves, read
[epub-read-along.md](./epub-read-along.md) — this file is the plan, that one is the system. · **Design authority:** [`CONTEXT.md`](../CONTEXT.md) ·
**Decisions:** [ADR-0038](./adr/0038-alignment-maps-are-paired-by-enumeration-not-by-name.md),
[ADR-0039](./adr/0039-epub-read-along-is-a-second-surface-over-ingested-alignment-maps.md)

**Producer contracts (read them, do not restate them):**
`/Users/markmccoid/Documents/myProgramming/MacOS/LAABS Audio Align/docs/contracts/alignment-map.md`
and `docs/DECISIONS.md` in the same repo — D4, D8, D21, D46, D47 (D6 and D20 are closed).

EPUB Read-Along shows the audiobook's own EPUB, highlighting each Text Unit as the Alignment Map times
it against the Listening Position. It is the second surface under Read-Along; Transcript Read-Along
(shipped) is the first.

---

## The gate — closed

The Alignment Map contract used to forbid this work until one number existed: *is the fixed
decoration cost paid per apply, or per group?* **It is per group**, measured by stopwatch on a
physical iPhone 16 (E8; LAABS Audio Align D47).

| N | E5 (old) | E8 |
|---|---|---|
| 1 | 0.7 s | **0.4 s**, steady over repeated moves |
| 20 | — | **0.6 s** |
| 50 | 7.5 s | **~2 s** |
| 200 | 25 s | **~4 s** |

`t ≈ 0.4 s + 0.018 s × N` — an order of magnitude cheaper than E5's `0.6 + 0.12 N`, on the same
phone. A 1-decoration group re-applied while a 20-decoration group is painted costs 0.4 s, and the
20 **survive untouched and do not repaint**.

**What this settles.**

- The reader keeps **two decoration groups**: `window`, a screenful repainted only on a Resource
  turn (0.6 s, hidden behind the turn); and `active`, exactly one Text Unit re-applied per sentence
  at 0.4 s, with the window never re-sent.
- The active apply is **pre-fired** `LEAD_MS` before the unit's `startMs`. The cost is deterministic
  latency, never jank, and the map gives the exact millisecond — so the latency never becomes
  visible. **Calibrate the lead on the device**; a lead tuned on an iPhone 16 fires late on slower
  hardware, which is worse than not pre-firing.
- **The pessimistic fallback is dead.** Nothing in Phase 3 paints a screenful and accepts
  Resource-level sync.
- **D6's binding fork is closed.** At 0.018 s per decoration the `cssSelector` fork buys nothing,
  so the extractor never has to compute a DOM selector and D4 stands unqualified.

**One thing does not add up, recorded rather than chased.** E5 and E8 disagree by ~7× on the same
device. Candidates are resource size, a cold versus warm JS context, or the plain difficulty of
stopwatching "200 highlights visible" against one highlight moving. Every E8 number is better and
the architecture rests on the N=1 reading, the easiest of the set to time accurately.

**Do not re-measure this with the frame counter.** It reported a flat 60 fps at every N — the
anchoring runs inside WKWebView's own JS context, invisible to RN.

---

## Phase 1 — Producer (Mac repo)

1. Amend **D35** to `laabs.<epub-stem>.alignment.json` and define the sanitization rule for
   filesystem-illegal characters (SMB rejects `\ : * ? " < > |`). Record that the reader pairs by
   tolerant enumeration and never reconstructs the name — see ADR-0038.
2. Re-run `align` for `A Field Guide to Lies` (`87c842fa-8530-4082-b45e-9034c9192f04`) under the new
   name and delete `laabs.0adf089c.alignment.json`.
3. Run `laabs-align run` end to end for `83f829b9-1434-41a0-8acf-d6079e97b5fd`, so there are two
   aligned books to test against rather than one — and the second one has a 113-character EPUB
   filename, which is the case the naming change exists for.

Note that the Field Guide map verifies at 66.7% matched, which `laabs-align verify` itself calls
implausible. Whether that is the book, the EPUB, or the aligner is a producer question; the reader must
be built to display an honestly partial map either way, which is what the map's `unaligned` array is
for.

---

## Phase 2 — Ingest: server file to SQLite — **done**

Mirrors `src/transcription/` module for module, because that shape just worked. 87 new tests; the
whole suite is 740 passing.

| Module | Job |
| --- | --- |
| `src/components/bookComponents/alignment-files.ts` | Enumerate `laabs.*.alignment.json` from `libraryFiles`; tolerant stem match against `collectEbookFiles`; the free presence check that gates the entry point. |
| `src/alignment/alignment-artifact.ts` | Parse and validate `formatVersion: 1`, `kind: "alignment"`. |
| `src/alignment/alignment-ingest-plan.ts` | Pure. Collision decision, pairing check, Book Time recompute. |
| `src/alignment/alignment-ingest.ts` | Fetch by ino, plan, write. |
| `src/data/sqlite/shadow-db-alignment.ts` | `alignment_maps` / `alignment_resources` / `alignment_units`, indexed on `(library_item_id, start_ms)`. |
| `src/alignment/use-alignment-ingest.ts` | Gated on `enabled`, so nothing is fetched until the reader opens. |
| `src/alignment/epub-asset.ts` | The durable EPUB download — a **second** path beside `downloadsApi.downloadEbook`, not a change to it. |

### What the real artifacts changed

Both maps are ingested into the test suite (`A Field Guide to Lies`, `The Seven Tensions of
Negotiation`), and they contradict the contract's worked example in three ways:

- **A Text Unit may carry no timing at all** — 1,416 of 4,723 in one book. Modelled as `timing:
  null`, one nullable group rather than five nullable fields.
- **`p` cannot identify those units.** Every untimed unit reports `p: "i"`, and so does every
  genuinely interpolated one. **The presence of a timing is the only discriminator**, and
  `getTimedAlignmentUnits` filters on `start_ms IS NOT NULL` for exactly that reason.
- **Resources never carry `title`**, and those without timed units carry no `trackIndex`/`startMs`
  either. Two resources hold zero units.

The two books also differ enough to be worth keeping as a pair: 66.7% matched versus 95.9%, and
hrefs under `OEBPS/` versus `OPS/`.

### Two things ingest cannot check

**`epub.sha256` is not verifiable on device.** Comparing it means hashing the whole EPUB, the thing
ADR-0038 avoided. Ingest verifies `derivedFrom.epub.ino` against the paired ebook instead — weaker,
because D36 says an ino changes on re-import — records the sha256 for later, and treats a mismatch
as the dismissible Q14 notice rather than a refusal.

**`libraryFiles` can name a file that is not there.** Observed on this project's own server: after
`align` renamed a map, the pre-rescan listing still advertised the old name and its download
404'd. The presence check reads that listing, so it can offer a map that cannot be fetched;
`hasAlignmentLibraryFile` says so in as many words, and ingest reports `failed` rather than
pretending.

---

## Phase 3 — The reader — **largely built**

Built: the surface picker, the `ReadiumView` host with the re-apply guard, `leadMs` pre-firing, the
decoration group, resource turns, Follow Mode with its acknowledgement classifier, and the staleness
notice. **Not built:** the empty state's secondary action, and the download sheet's Transcript card
gate. Behaviour, measured constants and open defects are documented in
[epub-read-along.md](./epub-read-along.md) rather than here.

### Original plan

Shape is settled; see the gate above.

1. **Surface control** at the top of `read-along-screen.tsx` — *Transcript* | *Book*. Top, not inline:
   swipes starting inside the reader panel are swallowed by the WebView and turn pages. The gate is
   iOS **and** an EPUB **and** a map; no Book Transcript is required.
2. **`<ReadiumView>` host** with the `onPublicationReady` re-apply guard. `ready` has been observed
   firing twice, and a remount silently drops every painted decoration; hold the current groups in a ref
   and re-apply on every ready. Costs one fixed apply behind the book opening.
3. **`useReadAlongPosition` + optional `leadMs`.** Pre-firing is `interpolatePosition(anchor, nowMs +
   leadMs)` — and since that function multiplies elapsed wall time by `rate`, it looks ahead by
   `leadMs × rate` in book time automatically, which is correct at 2× with no special case. Transcript
   Read-Along passes 0. Clamp so the active unit can never precede the current one on a short sentence.
4. **Decoration Window** — settled by Phase 0. A `window` group of a screenful, repainted only on a
   Resource turn; an `active` group of exactly one unit, pre-fired per sentence, sent **alone** so
   the window is not re-anchored. Clear a group by sending it empty — **never** by omitting it, or it
   stays painted. `LEAD_MS` is calibrated on device, not hardcoded.
5. **Resource turn.** `goTo({ href, locations: { progression: unit.g } })` when the Listening Position
   crosses into a new Resource. E6 measured `goTo` by progression landing within 0.0002.
6. **Staleness surfacing.** Silent for `tracksFingerprint` (recompute), `extractorVersion` (drop cached
   per-unit state) and `transcriptId` (informational). One dismissible, non-blocking notice for an
   `epub.sha256` mismatch. There is no honest automatic test — Readium's matcher applies no score
   threshold and returns its best candidate however poor, so almost everything "resolves" and a
   "% resolved" signal would be a lie.
7. **Unaligned regions light nothing.** `findActiveSegmentIndex` already returns `NO_ACTIVE_INDEX`
   inside gaps; an `audioOnly` stretch is exactly that case.

**Locator shape** — a Text Unit maps to a `Locator` by renaming only:

```ts
{ href: resource.href, type: resource.type,
  locations: { progression: unit.g },
  text: { before: unit.q.b, highlight: unit.q.h, after: unit.q.a } }
```

E1 confirmed on device that `text` alone anchors at word precision with no `locations` at all, so `g`
is navigational, not load-bearing. `href` is the manifest href resolved against the OPF directory, no
leading slash — and **not necessarily `.xhtml`**; a real book under test used `OEBPS/Chapter01.html`.

---

## Phase 4 — Verification

Delegated to an Agent with `model: "opus"`, per `CLAUDE.md`. Simulator covers the plumbing — ingest,
pairing, staleness paths, surface switching. The highlight itself needs a physical device, since the
decoration cost that shapes the whole design is invisible on the simulator.

---

## Deferred

- ~~**Tap-to-seek from the EPUB**~~ — **no longer deferred.** This was held behind the passive
  `(g, progression)` calibration, on the grounds that `g` is a character ratio and Readium's
  `progression` a rendered-pixel one. `onDecorationActivated` sidesteps that entirely: it returns the
  unit index outright, so the two quantities never meet. Verified firing on device (E9). Tracked in
  [epub-read-along-todo.md](./epub-read-along-todo.md).
- **Keeping the highlight on screen within a long Resource** still wants the calibration, and
  `onLocationChange` returns an empty `text`, so there is no fallback.
- **Selection to clip.** See ADR-0039, and the decision record in
  [epub-read-along-todo.md](./epub-read-along-todo.md).
- **Android.** iOS Podfile wiring only, and the cost model is a WKWebView number.
- **Percent-encoded hrefs.** Unexercised — no book under test has a space or accent in a chapter
  filename.
- **The double-`ready` root cause.** Guarded in Phase 3; chase only if the guard proves insufficient.

## Where sub-agents fit

- **Phase 0** — an Opus agent builds the two-group spike case and prepares the device; the stopwatch
  reading is yours. Per `CLAUDE.md` the main thread must not drive the simulator.
- **Phase 2** — splits cleanly in two: the SQLite concern module, and the artifact/plan/ingest trio.
  They meet at `IngestedAlignmentWrite` and can be written in parallel once that type is fixed.
- **Phase 4** — mandatory delegation.
