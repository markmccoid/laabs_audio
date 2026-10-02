# PDF Read-Along: extraction, rendering, alignment, and cost

Research date: 2026-09-30. This is an options analysis, not an implementation or a new ADR. Platform capabilities below are documented; the proposed architecture, cost controls, and staged delivery are engineering recommendations that still require a representative-book spike.

## Recommendation

Start with **audio-to-page alignment and automatic page navigation**, then add sentence/line highlighting, then optional word highlighting. These are useful independently. Page following preserves charts, diagrams, typography, and tables while requiring very little alignment metadata and infrequent UI updates.

For the Mac producer, try **Apple PDFKit text extraction**, with **Vision OCR** for scanned pages. Keep extraction, reading-order correction, OCR, and alignment in LAABS Align rather than doing that work during listening. For the iOS consumer, first investigate **reusing the PDF navigator already present in the installed Readium native source**. A small native overlay bridge can add highlighting later. PDF.js in a WebView is the strongest alternative if a shared iOS/Android highlighting implementation is the priority.

Distinguish two content classes at import:

- **Full-text PDF:** substantially contains the text being narrated. Automatic text alignment can derive page intervals and later finer highlights.
- **Supplement PDF:** figures, slides, tables, worksheets, or selected excerpts. There may be no corresponding narration to extract and align. Use manually placed time-to-page cues, assisted by caption/reference matching where available.

A PDF image of a graph cannot by itself establish when the narrator discusses it. OCR discovers labels, not that semantic correspondence. A reviewed cue such as “show physical page 7 at 01:23:45” should be a first-class output, with repeated visits to a page allowed.

## Documented extraction options

### Apple PDFKit on macOS

`PDFPage.string` exposes page text; `numberOfCharacters`, `characterBounds(at:)`, and `selection(for: NSRange)` provide character positions and selected ranges. `PDFSelection.bounds(for:)` provides bounds and `selectionsByLine()` splits a selection into lines. This supports tokenizing page text, retaining its original character ranges, and recovering geometry for each token or sentence. [PDFPage](https://developer.apple.com/documentation/pdfkit/pdfpage), [PDFSelection](https://developer.apple.com/documentation/pdfkit/pdfselection/pages).

Page space uses points at 72 units/inch with a lower-left origin; coordinates can be fractional. Store page boxes and rotation, not just a width/height guess. [characterBounds(at:)](https://developer.apple.com/documentation/pdfkit/pdfpage/characterbounds(at:)).

**Recommendation:** use this as the first extractor because LAABS Align is a Mac app. Preserve a mapping from normalized alignment tokens back to original page/character ranges and geometry. Do not discard that mapping when joining a hyphenated word or removing headers. One narrated word can require multiple visual boxes if it crosses a line or page. Character offsets are extractor-specific; a Mac offset should not be assumed to identify the same text range in another engine. Explicit geometry avoids that dependency.

Text extraction is only the start. Validate multi-column order, sidebars, repeating headers, footnotes, ligatures, and Unicode on actual books. Geometric position and narration order are separate concerns. Retain the raw extraction on the Mac for diagnostics, but publish only the data the mobile reader needs.

### Scanned PDFs: Vision OCR

Vision recognizes text in images using `VNRecognizeTextRequest` and provides recognized text, confidence, and normalized bounds. Recognition runs on the user's device. The accurate path differs from the fast path and allows language configuration. [Recognizing Text in Images](https://developer.apple.com/documentation/vision/recognizing-text-in-images).

`VNRecognizedText.boundingBox(for:)` can locate a substring. Apple says these boxes are approximate; the accurate path provides word precision, while the fast path provides character precision. [boundingBox(for:)](https://developer.apple.com/documentation/vision/vnrecognizedtext/boundingbox(for:)).

**Recommendation:** rasterize a scanned page on the Mac, OCR it, convert image coordinates into the stored PDF coordinate system, and align its words. Detect missing or unusable text rather than treating every nonempty text layer as good. Mixed PDFs may need OCR on only some pages. Low-confidence OCR or alignment should fall back to a reviewed page cue; it should not manufacture precise word highlights. Publishing geometry also allows highlights over the original scanned PDF without modifying it into a searchable PDF.

### PDF.js

PDF.js exposes page text items containing a string, transform, width, height, direction, and font reference. An item is a text part rather than a guaranteed word. A word-box extractor needs an additional mapping/splitting step. [PDF.js text API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).

It provides page rendering, viewport transforms, text extraction, and cleanup APIs. Its text layer lays out DOM text runs over the rendered content. [PDFPageProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html), [text layer source](https://github.com/mozilla/pdf.js/blob/master/src/display/text_layer.js).

**Recommendation:** consider it when using the same engine in producer and viewer is valuable. Extracting text parts does not eliminate reading-order cleanup or scanned-page OCR. Avoid distributing raw PDF.js output wholesale: font tables, transforms, and parser details are not the consumer contract. PDF.js is Apache-2.0 licensed. [License](https://github.com/mozilla/pdf.js/blob/master/LICENSE).

### MuPDF / PyMuPDF

MuPDF structured text supports blocks, lines, character walking with quads, text searching, and selection-highlight quads. Its simplified JSON output is not equivalent to the full character/quad traversal, so choose the appropriate extraction API. [StructuredText](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/StructuredText.html).

MuPDF is offered under AGPL and commercial licenses. That is a product licensing decision, not a harmless replacement for PDFKit. Assess the terms for the intended distribution before choosing it; no commercial pricing was established in this research. [MuPDF licensing](https://mupdf.readthedocs.io/en/latest/license.html).

**Recommendation:** keep it as an extraction/geometry comparison candidate if PDFKit struggles on the real corpus. Do not select it solely because its word/quad helpers are convenient. PyMuPDF is a binding to this ecosystem, not an independent way around those licensing considerations.

## Reader and highlighting options

| Option | Documented or inspected capability | Implication for LAABS |
| --- | --- | --- |
| Existing Readium native PDF navigator | Swift Toolkit has a PDF navigator; installed native source has PDF modules on iOS and Android. | Best first page-following spike; verify a clean installation reproduces what is currently in `node_modules`. |
| Small native PDFKit view or extension | PDFKit displays/navigates PDFs, supports selections and coordinate conversion; page overlays are available since iOS 16. | Good iOS geometry highlighting path. Existing iOS 17.4 deployment target covers the overlay API. |
| `react-native-pdf` | Displays PDFs with paging/zoom and a `setPage()` method; JS types do not expose arbitrary timed highlight rectangles. | Convenient separate viewer for page following, but word highlighting requires native customization. |
| PDF.js inside a WebView | Canvas rendering plus DOM text layer and viewport transforms. | Shared overlay code across platforms; requires explicit visible-page virtualization, local-file loading, and performance measurement. |
| Custom Android `PdfRenderer` viewer | Platform renderer exists from API 21; newer extraction/selection APIs arrive in API 35. | Greater control, but substantially more reader work; do not base broad Android support on modern text APIs alone. |

Sources: [Readium navigator guide](https://github.com/readium/swift-toolkit/blob/develop/docs/Guides/Navigator/Navigator.md), [PDFView](https://developer.apple.com/documentation/pdfkit/pdfview), [PDFKit interactions](https://developer.apple.com/documentation/pdfkit/document-interactions), [page overlays, WWDC22](https://developer.apple.com/videos/play/wwdc2022/10089/), [react-native-pdf](https://github.com/wonday/react-native-pdf), [react-native-pdf JS API](https://github.com/wonday/react-native-pdf/blob/master/index.d.ts), [Android PdfRenderer](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer).

Commercial SDKs are another option if maintaining a custom reader extension becomes costly. Nutrient and Apryse provide React Native PDF viewing and annotation SDKs. They still need LAABS's alignment producer, timing lookup, and Follow Mode integration; annotations alone do not establish audio correspondence. Evaluate a transient overlay path and commercial terms before selecting one. No pricing or energy advantage was established here. [Nutrient React Native guide](https://www.nutrient.io/guides/react-native/intro/), [Apryse React Native guide](https://docs.apryse.com/ios/guides/react-native).

### Readium needs a specific check

Local inspection on 2026-09-30 found installed `react-native-readium` 5.1.1 source registering `PDFModule` and constructing `PDFNavigatorViewController`; Android constructs a PDFium-backed `PdfReaderFragment`. The installed README nevertheless labels PDF unsupported. Local source therefore establishes a promising existing path, not a verified released support guarantee. Upstream documentation/source can differ from an installed or patched tree.

The installed iOS PDF navigator exposes `pdfView`, a `PDFDocumentView` subclass of `PDFView`, and a setup delegate hook. It **does not conform to `DecorableNavigator`**. The JS bridge's decoration path casts to that protocol, so the current EPUB highlight mechanism will skip this PDF navigator. Current EPUB DOM tap handling also does not apply to PDF. Upstream source has the same absence of decoration conformance. [PDF navigator source](https://github.com/readium/swift-toolkit/blob/develop/Sources/Navigator/PDF/PDFNavigatorViewController.swift).

**Recommendation:** prove PDF loading, page locators, seeking, zoom/rotation, and lifetime from a clean build before adding another viewer dependency. If that works, add a narrow PDF highlight API that updates a native overlay on the current page. PDFKit sizes and rotates overlay views and requests them as pages approach visibility, rather than requiring one view per document page. [Page overlay lifecycle](https://developer.apple.com/videos/play/wwdc2022/10089/).

PDFKit's `highlightedSelections` is another possible route for embedded text, but externally generated/OCR geometry should not depend on reconstructing a native text selection. Overlay boxes support both. Native changes require rebuilding the Expo development/release app. [Selection highlights](https://developer.apple.com/documentation/pdfkit/pdfview/highlightedselections), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

On Android, `getTextContents()` arrives in API 35. `PdfPageTextContent.getBounds()` returns line-level rectangles, not a universal word-box API. This is not needed on the phone if Align supplies geometry. [Page text extraction](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer.Page#getTextContents()), [text content bounds](https://developer.android.com/reference/android/graphics/pdf/content/PdfPageTextContent#getBounds()).

## Geometry versus character offsets

**Recommendation:** ship page geometry when consistent positioning across macOS extraction, native rendering, WebView rendering, and OCR matters. A smaller alternative stores page-local character offsets plus timed ranges and computes selection bounds on the phone. That requires validating extractor identity, text order, normalization, UTF-16 range semantics, and engine/version parity; it also adds extraction work during first open or page changes. OCR geometry has no native PDF text selection to reconstruct unless an OCR text layer is embedded first. A hybrid can use offsets for supported embedded-text PDFs and boxes for OCR or troublesome pages, but the complexity must earn its savings in measured exports.

For a phrase spanning lines, preserve a list of rectangles/quads rather than its one large enclosing rectangle. For a word split by hyphenation, retain both display fragments and their token identity even when alignment uses one normalized word. These are contract decisions, not properties every extraction engine automatically guarantees.

## Battery and responsiveness: proposed controls

No source reviewed establishes a battery ranking or credible battery-drain percentage for these implementations. Compare them on physical devices with the same PDF, playback speed, brightness, and session length.

The design objective is to render static PDF content independently from the changing location cue:

- Render/cache visible and nearby pages; update one small highlight overlay when the active unit changes. Avoid rerendering a whole PDF page for each word.
- Send a compact unit ID or current geometry across the JS/native boundary, not the full book's decoration list on every position event.
- Schedule around actual boundaries rather than animating continuously at 60 Hz. Reschedule on seek, pause/resume, and speed changes; use playback's current position to correct drift.
- Stop visual work when the reader is hidden or backgrounded. Page-only mode updates when the target page changes; no PDF extraction/OCR runs during playback.
- Preserve Follow Mode: manual browsing pauses automatic navigation; explicit resume follows again. A seek resolves the target page immediately.

Canvas/bitmap memory deserves its own budget. For example, a 1,200 × 1,600 RGBA bitmap is 7,680,000 bytes before other buffers; high zoom and several cached pages multiply this. This calculation is not a renderer benchmark. Limit page caches and cap raster scale appropriately. A persistent DOM text layer is optional when external geometry drives highlights.

## Domain boundary

The current glossary and ADR-0039 define Alignment Maps/Text Units specifically for EPUB. “PDF Read-Along” here is a proposed extension. Its asset pairing, geometry addressing, page cues, and consumer obligations need an explicit domain/contract decision; they should not be silently squeezed into EPUB quote anchors.

## What the existing LAABS code makes reusable

Local code and producer contracts were inspected on 2026-09-30. These observations describe this checkout rather than a claim about an upstream release:

- [EPUB architecture](../epub-read-along.md) and [ADR-0039](../adr/0039-epub-read-along-is-a-second-surface-over-ingested-alignment-maps.md): Alignment Maps are ingested into SQLite on first reader open, and EPUB assets are retained independently of Downloaded Audio Assets. Reuse that lifecycle for PDFs.
- `src/read-along/use-read-along-position.ts`: the shared clock interpolates playback position, accounts for Playback Rate, and changes React state only at active-index transitions. Reuse this time source. Its current polling intervals are 150 ms for segments/EPUB and 40 ms for transcript words. Page following does not need the word cadence; boundary scheduling could further reduce wakeups. Explicitly gate background work as well as screen focus.
- `src/components/bookComponents/ebook-files.ts`: PDFs already appear in ebook enumeration. `alignment-files.ts`, the artifact parser, and the SQLite schema are explicitly EPUB-specific; simply accepting `.pdf` in one filter is insufficient.
- `src/data/sqlite/shadow-db-core.ts`: `alignment_maps` currently has one row per library item. An EPUB and a PDF on the same item need distinct document/map identities so opening one cannot replace the other. Discovery also needs to distinguish `Book.epub` from `Book.pdf` when their stems are identical.
- `src/api/downloads-api.ts`: the general ebook download is temporary and deleted after sharing. A PDF reader needs durable storage comparable to `src/alignment/epub-asset.ts`. `getDownloadSpec` requests `Accept-Encoding: identity`; explicit compressed artifact handling is necessary if compression is part of the contract.

The producer authority is in the sibling Mac repo: `/Users/markmccoid/Documents/myProgramming/MacOS/LAABS Audio Align/docs/contracts/alignment-map.md` and `docs/alignment.md`. Its `Aligner.swift` already matches normalized book tokens to timed transcript words using `SequenceAlign`. The current book-token source identity is a sentence/Text Unit, and the output aggregates matches into sentence timings. The sequence matching core is reusable; a PDF adapter must retain page/word geometry identities, and word output must preserve the individual matches instead of only their sentence envelope. No new speech recognition pass is necessary when a suitable timed Book Transcript already exists.

Preserve Track Time as the source of timings and recompute Book Time when track offsets change, as the current ingest contract does. A PDF page can contain text from multiple tracks; a page cue may need multiple intervals rather than one track field for the entire page.

## Proposed smallest useful contract

Separate producer extraction data from exported playback data. Keep full extracted text, token normalization mappings, OCR diagnostics, and matching candidates in Align. Export three independently useful levels:

| Level | Mobile data | Runtime behavior |
| --- | --- | --- |
| Page following | PDF identity, audio track identity, timed page cues, provenance/confidence, honest gaps | Navigate only when the target page changes. |
| Sentence/line highlighting | Above plus timed visual regions, possibly several rectangles across pages | Move a transient overlay at region boundaries. |
| Word highlighting | Above plus reliable word timings and geometry, optionally loaded by page | Move the overlay at word boundaries; preserve gaps instead of assigning invented timings. |

Use physical zero-based page indices in the artifact and display printed page labels separately. Readium's `page=N` locator uses one-based page numbers, so convert at the adapter boundary. Store the PDF hash, extraction/schema versions, and an explicit coordinate convention including crop/media boxes and rotation. Geometry and timing changes must invalidate cached detail, not just changes to the filename.

For a supplement, a cue can say “from Book Time 123,000 ms to 168,000 ms, display physical page index 6.” Several cues can point to the same page, and later cues can revisit an earlier page. Sort by audio time; do not require page indices to increase. Main-book automatic text matching can remain monotonic, while supplement cue authoring supports repeated references.

For full-text PDFs, derive page boundaries from matched tokens on each page, including sentences split across pages. Review uncertain boundaries in Align. Do not derive transitions by dividing the audio duration by the PDF page count. For a gap, holding the last page is a possible explicit presentation policy; it must not create a fictitious precise highlight. Keep pages without narration manually browsable.

This differs materially from EPUB addressing. EPUB permits a source-hash mismatch with a warning because Quote Anchors can still locate text. PDF coordinates may point at unrelated content in a changed edition. **Recommendation:** withhold automatic geometry highlights for an unverified/mismatched PDF; regenerate or explicitly establish a new pairing. Document this stronger rule in the PDF contract rather than silently changing the EPUB policy.

## Download size and memory

Two existing EPUB artifacts were measured locally using Python `gzip.compress` on their minified JSON. Both originals were already minified; no source prose was changed.

| Artifact | Text Units | Raw bytes | Gzip bytes | Reduction |
| --- | ---: | ---: | ---: | ---: |
| A Field Guide to Lies | 4,723 | 1,465,193 | 375,840 | 74.3% |
| The Seven Tensions of Negotiation | 3,238 | 1,064,421 | 267,624 | 74.9% |

These are **EPUB measurements**, not a prediction for PDF coordinate data. They justify testing explicit compression before making a format difficult to inspect merely to shorten field names. PDF hashes, page geometry, and the PDF itself need their own size measurements.

Illustrative budgets, **not measured PDF exports**:

- 400 page cues at an assumed 100 bytes per compact JSON cue are about 40 KB, plus document/track metadata, confidence, and gaps. Supplements often need fewer cues; revisits can increase the count.
- 100,000 timed words at an assumed 100–200 bytes per JSON record are about 10–20 MB before compression. Duplicated quote context, full text, extra boxes, and verbose nesting can increase this substantially.
- Two 32-bit millisecond times and four 32-bit coordinates are 24 bytes per word: 2.4 MB for 100,000 words **before** page/track references, additional boxes, text, and headers. This is numeric payload arithmetic, not a ready-to-use binary format.

Start with a small page schedule and a separate optional compressed detail artifact. Page-only users should not download word data. Store text once per page, with offsets only if the consumer actually needs text; geometry-driven highlighting alone need not duplicate the prose. Cache PDF files durably and ingest timing/detail data into SQLite, loading current and nearby page geometry into memory.

A single gzip/ZIP artifact still downloads in full. Lazy decoding inside that file only reduces runtime memory. Selective **network** downloads require separately discoverable detail chunks, or range access that the Audiobookshelf Server and client actually support. Verify server discovery/download behavior before committing to many per-page files. A bounded single optional detail file is a simpler initial design; add chunks if measured books justify them.

Do not feed a large compressed map through the existing `response.text()` → `JSON.parse()` pipeline unchanged. Compressed transfer size, expanded JSON size, parsed JS object memory, and SQLite ingest time are separate costs. Measure peak memory and first-open delay; use download-to-file and bounded/chunked ingestion when needed. A ZIP containing page entries does not by itself guarantee bounded-memory decompression—choose and measure the extraction path.

The original PDF may be larger than all alignment metadata, particularly for scans. Preserve original page quality for charts and zoom; assess PDF download cost separately rather than solving only the JSON size.

## Recommended next experiment and delivery order

1. **Page-only spike:** use an ordinary text PDF, a multi-column PDF, a scan, a rotated/cropped page, and a graph supplement. Verify clean-build Readium PDF loading, one-based locator conversion, random seeks, offline reopen, and manual browsing with Follow Mode suspended.
2. **Align page cues:** implement automatic boundaries where transcript overlap supports them and a small cue editor for supplements/uncertain pages. Allow preview and correction. Measure page-transition accuracy and report unaligned coverage.
3. **Highlight spike:** extend the existing iOS PDFKit host with one transient page overlay. Compare embedded-text and OCR geometry at different zooms/orientations, including multi-line and cross-page words. If Readium integration proves awkward, compare a small standalone Expo PDFKit view; if shared-platform delivery is central, compare PDF.js.
4. **Measure before choosing word mode:** compare the same physical device, PDF, brightness, and Playback Rate with static reading, page following, sentence/line highlighting, and word highlighting. Record CPU/GPU activity, memory, page-render frequency, highlight latency, and energy/thermal behavior in a release build. Do not carry the EPUB's measured ~400 ms decoration lead into PDF without measurement.
5. **Freeze the producer/consumer contract:** update the domain definitions and ADRs, then implement persistent assets and detail ingestion. Ship page following independently; add sentence/line and word detail as optional capabilities after their quality and cost are established.

No PDF corpus was supplied or exercised in this analysis. API/source inspection and the EPUB compression measurements establish feasibility and design constraints; they do not establish PDF extraction accuracy, rendering latency, or battery consumption for LAABS.

## Proposed Read-Along surface selection

Extend the existing top selector from `Transcript | Book` to `Transcript | EPUB | PDF`. This remains one Read-Along screen with one playback position and shared audio controls. Show only the surfaces the library item can offer; hide the selector when only one is available. Preserve the existing transcript creation/resume experience as an empty state when no reading surface is available.

Eligibility is distinct from successful loading:

- Transcript: locally available transcript content or a discovered shipped transcript, including usable partial transcription content.
- EPUB: an EPUB with a discovered corresponding Alignment Map on a supported platform.
- PDF: a PDF with a discovered corresponding page Alignment Map on a supported platform.

Cached assets/maps also establish availability offline. Discovering a map offers the tab without downloading it; selecting the tab validates/ingests it and loads the document. A fetch or validation failure stays on that selected surface with an explanation and retry action. A PDF without a page map remains an ordinary ebook attachment rather than being presented as synchronized reading in this first version.

Store the original PDF as a separate Audiobookshelf library asset beside its map. The page map identifies the particular PDF through a document reference and hash; it does not embed PDF bytes. Filename matching assists discovery, while map identity validates the pairing. If there are several PDFs, the selected PDF surface can offer a small document chooser, with each document retaining its own map and cache.

An explicit surface request wins over a remembered per-item selection. If that choice is unavailable, use an available fallback. Keep existing EPUB-first behavior for new items; default to Transcript when available, otherwise PDF. This conservative default accommodates chart supplements without unexpectedly making them the main reading surface. A future main-text/supplement distinction could refine that default.

Selecting a surface keeps audio playing at its existing position and opens the corresponding text/page, resuming Follow Mode as an explicit request to see the current narration. Manual scrolling/page browsing suspends Follow Mode; the existing Resume Follow action returns to the narrated position. Seeking or changing Playback Rate resolves against the same audio time source. Unaligned PDF intervals have an explicit presentation policy, such as retaining the last page with a notice; they do not create inferred precise timings.

The PDF body initially offers fit-to-width, pinch zoom, page navigation, and a physical page counter, with optional printed labels. Its header controls offer PDF view settings rather than EPUB font size/line spacing. Page following issues a navigator command only when the target page changes. Switching surfaces should stop the hidden reader's timer/render work and retain its durable asset, so revisiting a tab does not redownload it.

Implementation would add a PDF surface beside `EpubReadAlongSurface`, make surface availability explicit, and replace the screen/header's current binary `isBookSurface` assumptions with format-aware behavior. Internal surface names can become `transcript | epub | pdf`, retaining `book` as an alias for existing EPUB route requests. The PDF addition also needs document-scoped storage so its map can coexist with the EPUB map.
