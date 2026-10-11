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
- **Multi-chapter m4b: ✅ verified on device** (2026-10-10, release build, 233 MB m4b, 7h50m,
  18 chapters). Chapter starts are contiguous, and the last chapter's end equals the file
  duration exactly. Reading took 57 ms.
  - Titles come back padded (`" Chapter 2- Lists "`), so **trim chapter titles**.
  - The chapters in that file are in *alphabetical* order ("Acknowledgments, Chapter 1…13, Ending
    Credits, …, Introduction, Opening Credits"). The audio itself was assembled that way by
    whatever tool built the m4b. We play chapters in time order and never re-sort them. This is
    also real-world evidence for multi-file import: plain alphabetical sorting goes wrong, so
    prefer track-number tags (`trkn` / `TRCK`) over filename order.
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
- ~~Use `copyToCacheDirectory: true` + `moveAsync`.~~ **Superseded:** expo copies twice, does
  the second copy on the main thread, and leaves the first copy in the Inbox. See "Second-pick hang"
  below.
- **On device, a 233 MB m4b imported fine**: `moveAsync` took 4 ms. The picker reported
  `mimeType: application/octet-stream` for `.m4b`, so **validate by extension plus `isPlayable`,
  never by mimeType**.
- **`audio/*` returns `.m4a`** as `audio/x-m4a`. The mp3 and m4b picker paths weren't exercised
  (simulator Files browsing was blank), but they read correctly from a path.
- **Picker timings in the spike include tapping time and aren't meaningful.**

### Second-pick hang with expo-document-picker (reported on device, 2026-10-10)

What the user saw: after clearing the spike data, a second pick of the 250 MB m4b sometimes did
nothing. The picker stayed on screen showing the file. The first pick returned in 1–2 s.

The cause is in expo-document-picker 57.0.2's iOS code (`DocumentPickerModule.swift`):
1. It opens the picker with `asCopy: true`, so iOS copies the file into
   `tmp/<bundle>-Inbox/` before the app is told. **That copy is never deleted.** Simulator
   confirmed it: each expo pick adds a file to the Inbox.
2. With `copyToCacheDirectory`, it does a second, **synchronous `FileManager.copyItem` on the
   main thread** inside `didPickDocumentsAt`. A 250 MB copy there freezes the UI with the picker
   still on screen. The leftover Inbox copies fill storage and make later copies slower.

Native alternative (`AudioImport.pickAndCopyAudio`): opens the picker with `asCopy: false`, then
does one `NSFileCoordinator` copy on a background queue straight into the destination. The
coordinated read also makes iOS download an iCloud-evicted file first, and reports how long that
wait took as `coordinationWaitMs`.

Simulator smoke test: all steps passed. The native pick is security-scoped. On a 1.6 MB file the
coordination wait was 11 ms and the copy took 0.3 ms. It left no Inbox leftover. Swiping to
dismiss resolves `canceled`, and the picker reopens afterwards. Clearing leftovers works.

**Decision (pending device confirmation):** production import uses the native picker, not
expo-document-picker.

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
3. **Phase 2:** the import uses the native `pickAndCopyAudio` picker: one copy, off the main
   thread, no Inbox leftovers. Not expo-document-picker. Duplicate fingerprint = name + size +
   duration.
4. **Chapter fallback:** a single whole-file chapter counts as no chapters. Trim chapter titles.
5. **Format validation:** by file extension plus `isPlayable`, not mimeType.

## Still open: needs a physical device or better fixtures

- [x] **Multi-chapter m4b**: verified on device (18 chapters).
- [ ] **mp3 with ID3 `CHAP` chapters**: confirm whether AVFoundation exposes them.
- [ ] **iCloud-evicted files**: does the picker block while downloading, how long does it take,
      and what happens on failure or cancel?
- [ ] **Large-file (500 MB+) import time** through the picker on device.
- [ ] **Backup exclusion** confirmed in a real iCloud backup (Settings → iCloud → Manage Storage → Backups → app size).
