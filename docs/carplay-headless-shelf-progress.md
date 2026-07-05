# Headless CarPlay Shelf Progress Labels

## Problem

The CarPlay root screen shows each book's title plus a preformatted elapsed/remaining-time label. In a normal phone launch, `CarPlayShelfPublisher` mounts in the React tree, runs `useHomeShelves()`, and republishes shelves whenever the Home progress projection changes.

In a CarPlay-only headless launch, React never mounts. The CarPlay service restores the last `carplay-shelves-snapshot-v1` payload from MMKV, but that payload stores `detail` and `subtitle` as strings. Playback progress updates `carplay-resume-snapshot-v1`, yet the shelf strings are not rebuilt from that newer local progress.

## Fix Plan

1. Move CarPlay shelf label formatting into a pure helper that can be tested without native modules.
2. Include stable book metadata (`author`) in new shelf payloads so headless code can rebuild drill-down `detail` text without parsing a stale formatted string.
3. Overlay `carplay-resume-snapshot-v1` records onto the in-memory shelf payload whenever a snapshot is restored, when phone UI publishes shelves, and when headless playback records a new local progress sample.
4. Throttle live label refreshes to the existing CarPlay resume snapshot interval so headless playback does not push a native template update every second.
5. Keep old persisted shelf snapshots compatible: update the root-screen `subtitle`, but do not parse/rewrite old `detail` strings that lack the new `author` field.
6. Persist refreshed shelf labels back to `carplay-shelves-snapshot-v1` so a later headless cold launch starts from the latest local position.

## Implementation

- `src/carplay/carplay-shelf-labels.ts` owns duration formatting, shelf payload building, and local resume-progress overlay.
- `src/carplay/carplay-service.ts` now overlays resume snapshots after loading persisted shelves, after phone-side shelf publication, when the elapsed/remaining display setting changes, and on throttled playback progress samples.
- `CarPlayBookPayload` now carries `author` for newly written snapshots. Native CarPlay ignores unknown fields, so this is a JS-only compatibility addition.
- `CARPLAY_SERVICE_BUILD` is bumped to `attempt-i-20260705` for device-log verification.

## Verification

- Unit tests cover new payloads with author metadata, headless overlay updates, and old persisted snapshots without author metadata.
- Hardware verification: cold-start only from CarPlay, play a book for more than ten seconds, return to the root screen, and verify the visible remaining-time label decreases without opening the phone app.
