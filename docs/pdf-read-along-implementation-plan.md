# PDF Read-Along implementation plan

Date: 2026-10-01. Status: implemented and validated. This plan supersedes the research document's speculative page-cue format and manual-browsing proposal.

## Authority and confirmed decisions

The producer contract is `/Users/markmccoid/Documents/myProgramming/MacOS/LAABS Audio Align/docs/contracts/pdf-page-alignment.md`, format version 1, kind `pdf-page-alignment`, filename enumeration `laabs.*.pdf-pages.json`. This is a PDF Page Map, not an EPUB Alignment Map. The producer contract determines discovery, validation, rebasing, and page lookup.

The user confirmed:

- iOS first, matching the current EPUB Readium integration. Hide PDF Read-Along on unsupported platforms.
- Manual PDF browsing suspends Follow Mode without seeking audio. Resume following returns to the narrated page; Listen from page explicitly seeks timed pages and resumes following. PDF seeks and EPUB text taps offer a 10-second Go back toast. Untimed pages have no Listen action. Programmatic page navigation must never seek the audio in response to its own location callbacks.

## Implementation

1. Add strict PDF Page Map parsing and PDF-only discovery/pairing, preserving EPUB discovery unchanged. Validate the format, page identities/order, integer timings, provenance, track references, and quality. Use the existing tolerant stem matching; confirm document identity using the actual PDF bytes.
2. Retain the PDF as a durable library asset independent of audio downloads. Hash it with the existing native file API, and require both SHA-256 and Readium's actual PDF page count to match before enabling any page/audio synchronization. A mismatched or degraded map must not follow or seek; the PDF remains readable with an explanation.
3. Persist the map independently of EPUB maps, scoped to the book and PDF document. Keep all page records, including untimed pages. Reuse current audio-track ordering/time conventions, preserving supplied Book Time when the track snapshot matches and rebasing from Track Time when changed. Follow the documented cross-track limitations rather than altering producer timings.
4. Add a Readium-backed PDF surface inside the existing Read-Along screen. Extend the selector to Transcript, EPUB, PDF using available surfaces. Keep existing EPUB route requests compatible. Use shared audio controls and the current playback position; switching surfaces must not change audio playback.
5. Resolve the last timed page whose start is at or before Listening Position. Before the first timed page, stay put; after the last end, retain the last timed page. Follow interpolated pages as well as matched/manual ones. Convert physical zero-based page indices to one-based Readium page locators. Issue navigation only when the target changes.
6. Provide pinch zoom, existing PDF fit-to-width layout, page count, and the Follow toggle. Do not show transcript/EPUB typography settings on PDF. Stop visual timing work while the surface is inactive/backgrounded. Distinguish reader page turns from player-issued page navigation to prevent feedback loops; preserve paused/playing audio state when seeking.

Page-only synchronization is the scope. There is no word highlighting, extraction, OCR, cue editing, or Android reader work in this implementation. The contract does not provide repeated time intervals for the same page, so the research document's supplement cue scheme is deferred.

## Validation

- Meaningful unit coverage for pairing, map validation, stale track rebasing, page boundary lookup, unaligned/degraded states, strict PDF identity checks, and reader/player navigation classification.
- Verify the installed Readium PDF implementation is reproduced by the checked-in dependency/patch setup; preserve any required native fixes in the repo, rather than relying on edited node_modules.
- Run relevant existing alignment and Read-Along tests, TypeScript/lint checks, and native compilation when supported by this workspace.
- Exercise the user's Beyond Positive Thinking sample in the Audiobookshelf library: open PDF, first load/cache, seek across page boundaries, interpolated pages, manual turns while following, free browsing with Follow off, paused seeks, and switching between available surfaces. Record any device/build/environment verification limitations explicitly.

Update the glossary and an ADR for the distinct PDF Page Map identity/validation and confirmed reader-led seeking behavior. Keep the producer contract authoritative rather than copying it into this repo.

## Completed validation (2026-10-01)

- 313 tests passed in 25 PDF, Read-Along, EPUB alignment, and pairing suites. TypeScript and focused ESLint checks passed.
- Current iOS app built successfully on iPhone 17 Pro (iOS 26.5), with zero errors and 14 pre-existing/dependency warnings. The older installed binary initially lacked a current assistant native method; rebuilding resolved that startup issue.
- The actual Beyond Positive Thinking PDF opened with 210 validated pages. Manual next/previous and scrolling sought the correct starts while audio stayed paused; Follow off permitted browsing without a seek, and Follow on returned to the current page. Playback at 1.75× advanced across page boundaries without navigating audio back to page starts. Pinch zoom and Transcript/PDF switching/reopening worked and retained paused audio.
- A superseded native checkpoint after a completed seek is treated as cancellation, consistent with shared playback error presentation, so it does not falsely disable following.
- Automated tests cover interpolated pages, mismatches, degraded maps, timer focus/background cleanup, and failed download cleanup. Network-disconnected reopen and sustained device battery consumption were not measured; cache behavior and timer lifecycle are covered in tests.

## UX refinement — 2026-10-01

The initial reader-turn seeking behavior above is superseded by explicit Listen from page. Swipes and previous/next now suspend following without changing Listening Position; Resume following returns to live audio. The shared document-seek hook captures the pre-seek Listening Position and offers a 10-second Go back toast for PDF and EPUB, with paused/playing preservation, serialized seeks, and playback-identity guards. A superseded native checkpoint still permits undo when the player has already published the confirmed seek position. Toast IDs are unique per jump because Sonner refuses to recreate dismissed IDs.

Verification: 307 tests in 26 PDF, alignment, Read-Along, and reader-component suites passed; TypeScript and focused lint for the new code passed. The unchanged EPUB view baseline already has two effect-state lint errors and one dependency warning. On iPhone 17 Pro / iOS 26.5, swiping and previous/next preserved paused audio, Resume following returned from page 10 to page 9 without seeking, and an explicit page seek followed by Go back restored the exact prior position. The simulator was returned to its original 568,620 ms position with audio silent. EPUB tap recovery is covered by a component integration test; it was not retested live in this pass.
