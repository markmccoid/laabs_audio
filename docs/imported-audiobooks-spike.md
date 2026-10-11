# Imported Audiobooks — Phase 0 Spike Findings

Date: 2026-10-10. Branch `feature/imported-audiobooks`. Plan: [imported-audiobooks-implementation-plan.md](imported-audiobooks-implementation-plan.md).

Spike code (dev only, remove before shipping):
- `src/native/audio-import/AudioImport.swift`, an inline Expo module with `readAudioMetadata`,
  `setExcludedFromBackup` and `isExcludedFromBackup`
- Settings → "Import Spike" (`__DEV__` only), deep link `com.markmccoid.laabs-audio:///settings/import-spike`

Tested on the iPhone 17 Pro simulator (iOS 26.5). The native build succeeded with no fixes needed.

## Verdict: GO, with a small native module (no third-party library)

AVFoundation gives duration, playability, codec, standard tags, artwork and m4b chapter groups for
m4b, m4a and mp3. Reading takes 3–100 ms regardless of file size. Every fixture reported
`isPlayable: true`, including 64–110 minute files. The document picker already copies files into
the app's sandbox, and backup exclusion works.

## Metadata: where things live

| Field | m4b / m4a (iTunes atoms) | mp3 (ID3) | Mapping rule |
|---|---|---|---|
| Title | `©nam` → common `title` | `TIT2` → common `title` | common `title`, else `albumName`, else file name |
| Author | `©ART`, `aART` → common `artist` | `TPE1` → common `artist` | common `artist` (prefer `aART` when present) |
| Narrator | `©nrt` (raw only; no common key). Absent in both m4b fixtures | none standard; found only as `COMM` "Narrated by X" | raw `©nrt`, else a `COMM`/description match on `Narrated by (.+)`, else empty (user edits) |
| Description | `©des` → common `description`; also `©cmt` | `COMM` (raw only) | common `description`, else `©cmt` / `COMM` |
| Cover | `covr` | `APIC` | common artwork; written to a file (jpg/png detected) |
| Year / Genre | `©day`, `©gen` | `TDRC`, `TCON` | informational only |
| Series | not seen | `TXXX` values arrive **without their descriptions** | not supported in v1; needs `extraAttributes` to read TXXX keys |

Gotchas:
- Raw identifiers come back **percent-encoded**: `©nrt` is `itsk/%A9nrt`. Match against the `%A9` forms.
- `id3/TXXX` items expose only a value. Expose `item.extraAttributes` (the `info` key) if TXXX
  fields such as series are ever wanted.
- ffmpeg-made m4bs carry `©too = Lavf…` and an `org.mp4ra uiso/chpl` chapter list.

## Chapters: partly verified ⚠️

- m4b chapter groups load through `loadChapterMetadataGroups`. Both fixtures exposed one
  full-length "Chapter 01" from `chpl` (`chapterLocales: ["und"]`).
- **Multi-chapter m4b is untested.** No fixture had more than one chapter, and no tool to make one
  was available (no ffmpeg or mp4chaps).
- **mp3 ID3 `CHAP` chapters are untested.** AVFoundation is not known to expose ID3 `CHAP` frames.
  If it doesn't, mp3 chapters need a small ID3 parser in the native module, or we accept
  "one chapter per file" for mp3.
- **Rule to apply:** a single chapter that spans the whole file counts as "no chapters" (treat as one chapter per file).

## Document picker

| | `copyToCacheDirectory: true` | `copyToCacheDirectory: false` |
|---|---|---|
| Returned URI | `Library/Caches/DocumentPicker/<UUID>.m4a` (original name only in `asset.name`) | `tmp/<bundle>-Inbox/<original name>` |
| Into `laabs-imports/` | `moveAsync`, ~5 ms | `copyAsync`, ~100 ms for 1.6 MB, then the Inbox copy must be deleted |
| Metadata after import | ✅ | ✅ |

- **Both modes copy into the sandbox.** iOS opens the picker in import mode, so we never hold a
  long-lived security-scoped URL. That fits the "copy the file" decision.
- **Use `copyToCacheDirectory: true` + `moveAsync`.** It's one system copy plus an instant move,
  and it leaves nothing behind. Take the display name from `asset.name`, not the URI.
- **`audio/*` returns `.m4a`** as `audio/x-m4a`. The mp3 and m4b picker paths weren't exercised
  (simulator Files browsing was blank), but they read correctly from a path.
- **Picker timings in the spike include tapping time and aren't meaningful.**

## Backup exclusion

- Setting `isExcludedFromBackup` on the `laabs-imports` root works. The host shows the
  `com.apple.metadata:com_apple_backup_excludeItem` xattr.
- Children do **not** carry the attribute, and a per-file `isExcludedFromBackup` returns `false`.
  iOS honors the parent directory's exclusion for everything inside it.
- **Rule to apply:** set the flag on the `laabs-imports` root at startup, every launch (it's cheap and
  idempotent). Don't rely on per-file checks.
- Actual backup and restore behavior can't be checked on the simulator.

## Changes to the plan from these findings

1. **Phase 1:** promote `AudioImport` from spike to production: a typed metadata result with
   resolved `title / author / narrator / description / coverUri / chapters`, using the mapping
   rules above. Keep `raw` behind a debug flag only.
2. **Phase 1:** set backup exclusion on the `laabs-imports` root at startup.
3. **Phase 2:** the import uses `copyToCacheDirectory: true` and then `moveAsync`. Duplicate
   fingerprint = `asset.name` + size + duration.
4. **Chapter fallback:** a single whole-file chapter counts as no chapters.

## Still open: needs a physical device or better fixtures

- [ ] **Multi-chapter m4b**: pick a real one on device and confirm the chapter titles and starts.
- [ ] **mp3 with ID3 `CHAP` chapters**: confirm whether AVFoundation exposes them.
- [ ] **iCloud-evicted files**: does the picker block while downloading, how long does it take,
      and what happens on failure or cancel?
- [ ] **Large-file (500 MB+) import time** through the picker on device.
- [ ] **Backup exclusion** confirmed in a real iCloud backup (Settings → iCloud → Manage Storage → Backups → app size).
