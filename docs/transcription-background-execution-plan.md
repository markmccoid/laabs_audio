# Transcription Background Execution — Implementation Plan

Status: approved design, ready to build.
Design authority: `CONTEXT.md` (terms: **Book Transcript**, **Transcript Segment**, **Read-Along**) and `docs/adr/0034-book-transcripts-require-ios26-speechanalyzer.md`. Supersedes the "Processing: foreground-first, no BGProcessingTask, file-level resume" row of `docs/book-transcript-implementation-plan.md`. If this plan and those files disagree on anything else, those files win.

## The problem

Transcription is orchestrated from JS (`src/transcription/book-transcription.ts`): `runPendingTracks` awaits one `transcribeBookFile` promise per source file while Swift runs `analyzer.analyzeSequence(from: audioFile)` and streams `onSegments` back. Nothing in that path observes `AppState`, and `app.json` declares `UIBackgroundModes: ["audio"]` only.

When the screen locks with no audio playing, iOS suspends the process — JS run loop and Swift Task alike. Transcription does not fail, it **freezes**; on unlock it usually thaws, and if iOS jetsams the app first the entire current file is lost.

Two facts make that loss severe:

1. **The durable unit is one whole source file.** `transcribeOneTrack` buffers every segment of a file in a JS array; `insertSegmentsForTrack` writes them only after that file's promise resolves. `book_transcript_tracks.status` is binary `pending`/`complete`.
2. **Most books are a single large M4B**, chapters or not. `planTranscriptionSections` uses chapters for *output sectioning only* (EPUB chapters, Read-Along headings) — the *work* unit was always the file (ADR-0034, no chunker). So a 12-hour M4B is one indivisible unit with zero resumability, and its segment array is exactly the memory profile jetsam targets.

## Measured throughput

**2–3 minutes of wall clock per hour of audio (~20–30× realtime), device-measured.** A 12h book is ~25–35 min; a 30h book ~60–90 min. Every decision below depends on this number — re-measure before revisiting any of them.

The consequence that matters: a whole book transcribes inside a normal listening session, and a single multi-minute background window chews through roughly an hour of audio.

## Settled decisions (do not relitigate)

| Decision | Choice |
|---|---|
| Primary path | **Transcribe while the user listens, screen off.** Real playback under the existing `audio` background mode keeps the process alive. This is App Store legal — the mode is doing its actual job. Already observed working on a dev device. |
| Silent-audio keepalive | **Rejected.** Playing inaudible audio purely to stay alive violates App Store guideline 2.5.4. This app ships through the App Store. Never add it. |
| Screen-on keep-awake | **Fallback only, never the default.** Held only while a transcription is active *and* nothing is playing. Released the moment playback starts — background audio covers us and the screen may sleep. |
| Resume granularity | **Intra-file, watermarked in ms.** Mid-file starts are possible (`AVAudioFile.framePosition` is settable); the "we can only start at frame 0" assumption is wrong and is what this plan overturns. |
| Segment persistence | **Incremental.** Flush each `onSegments` batch into SQLite in the same transaction that advances the watermark. Never accumulate a whole book in a JS array. |
| Cancel semantics | Unchanged from `CONTEXT.md`: cancel leaves the row `in_progress` (resumable); only hard errors set `failed`. Cancel now *keeps* the work done so far rather than discarding the current file. |
| Concurrency | Unchanged: exactly one active Book Transcript, no queue. |
| Chunking | Still no audio chunker (ADR-0034). Mid-file resume is a seek, not a chunk — segmentation and punctuation quality are unaffected except at a resume boundary. |
| BGProcessingTask | **Built in Phase 5**, native route, scoped to a live-but-suspended process — a window granted to a terminated app is declined. See Phase 5 for why. |
| JS timers in the transcription path | **Banned.** They do not fire in a background/headless launch (`docs/carplay-debugging-log.md`, Attempt D). Every clock here is an incoming event; a time value may only ever be *checked* on one. |

## Existing code to reuse (verified paths)

- Orchestrator: `src/transcription/book-transcription.ts` — `runPendingTracks`, `transcribeOneTrack`, module-level `activeNativeTaskId` / `cancelRequested`.
- Pure planning: `src/transcription/transcription-planning.ts` — `mapSegmentsToBookAbsolute`, `resolveSectionIndexForStartMs`. Import-clean and unit-tested; keep it that way.
- Native: `src/native/book-transcriber/BookTranscriber.swift` — `startTranscription`, `flush`, `serializeResult`, the `sessionQueue` cancel bookkeeping.
- SQLite: `src/data/sqlite/shadow-db-transcripts.ts` (`insertSegmentsForTrack` is the transaction to split) and `shadow-db-core.ts` (`SCHEMA_VERSION = 6`, idempotent schema literal + `ALTER TABLE … .catch(() => undefined)` migrations, `withWriteGuard`, `runInTransaction`). Pattern in `docs/shadow-sqlite-architecture.md` / ADR-0019. **Do not touch `finalizeUnusedStatementsBeforeClosing: false`.**
- Playback state: `playbackStore` (`src/player/playback-store.ts`) — vanilla Zustand, `playbackState: PlaybackState` (`"idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error"`). Subscribe from non-React code exactly as `initializeTranscribeAfterDownloadWatcher` subscribes to `deviceBooksStore`.
- Keep-awake: `expo-keep-awake` is already a dependency. `activateKeepAwakeAsync(tag)` / `deactivateKeepAwake(tag)`. Read-Along uses `useKeepAwake()` with no tag (component-unique id) at `src/components/read-along/read-along-screen.tsx:90` — use a distinct explicit tag so the two locks can never interfere.
- Config plugin precedent: `./plugins/with-carplay` referenced from `app.json` → `plugins`.
- Any change under `src/native/` requires `npx expo run:ios` (CNG; `ios/` is gitignored).

---

## Phase 1 — SQLite: intra-file watermark (schema v7)

**Files**: `src/data/sqlite/shadow-db-core.ts`, `src/data/sqlite/shadow-db-transcripts.ts`.

1. Bump `SCHEMA_VERSION` to 7. Add the column to the `book_transcript_tracks` literal in `createSchemaSql` **and** as a migration `ALTER TABLE`:

```sql
ALTER TABLE book_transcript_tracks
  ADD COLUMN transcribed_through_ms INTEGER NOT NULL DEFAULT 0;
```

`transcribed_through_ms` is **track-relative** (0 = start of that audio file), so it maps straight onto the native `startSeconds` without re-deriving book offsets. `0` on every existing row is correct: an upgraded in-progress transcript simply restarts its pending track from the beginning, which is today's behaviour.

2. Split `insertSegmentsForTrack` into two functions, both `withWriteGuard` + `runInTransaction`:

- `appendTrackSegments({ libraryItemId, trackIno, segments, transcribedThroughMs })` — insert the batch **and** `UPDATE … SET transcribed_through_ms = MAX(transcribed_through_ms, ?)` in one transaction. Atomicity is the whole point: a kill between the two would either duplicate or lose a batch.
- `completeTrack(libraryItemId, trackIno)` — `status = 'complete'`, `completed_at = ?`, and pin `transcribed_through_ms` to `duration_ms`.

3. Extend `listPendingTracks`' projection with `transcribedThroughMs`.

4. Keep `insertSegmentsForTrack` exported as a thin wrapper (`appendTrackSegments` + `completeTrack`) until Phase 3 lands, so the tree stays green between commits.

**Acceptance**: fresh install and upgrade-from-v6 both open cleanly. Unit tests cover the watermark being monotonic (`MAX`, never regressing) and the append+watermark transaction rolling back as a unit.

## Phase 2 — Native: start transcription mid-file

**File**: `src/native/book-transcriber/BookTranscriber.swift` (+ `BookTranscriber.types.ts`, `BookTranscriberModule.ts`).

1. Add `startSeconds: Double` (default `0`) to `transcribeBookFile`'s options and to the TS types.

2. Replace `analyzer.analyzeSequence(from: audioFile)` with a self-fed input sequence when `startSeconds > 0`:

- `audioFile.framePosition = Int64(startSeconds * processingFormat.sampleRate)`
- read `AVAudioPCMBuffer`s in a loop (~10s each) into an `AsyncStream<AnalyzerInput>`
- attach each buffer's start time so emitted `audioTimeRange` values stay **file-absolute**, then hand the stream to `analyzer.analyzeSequence(_:)`

> **Verify against the iOS 26 SDK before building on it.** The exact `AnalyzerInput` initializer that carries a presentation time is the one genuinely uncertain API detail in this plan. If it turns out not to exist, the fallback is simple and equivalent: keep reading from the offset, and add `startSeconds` to every time in `serializeResult`. Either way the JS contract is unchanged — emitted times are always file-absolute. Confirm which path was taken in the commit message.

3. Rewind for context: the **caller** passes `max(0, watermark - 5s)`. Native never rewinds on its own. Recognition starting cold at an arbitrary point degrades the first sentence or two; the overlap is discarded in Phase 3.

4. Cancel must stop losing work. In the `for try await` loop, when `isCancelled(taskId)` breaks the loop, `flush(...)` the pending segments **before** rejecting with `cancelled`. Same in the `catch`. The JS side has already persisted everything it received, so the only rule is: never drop a batch the analyzer produced.

**Acceptance**: on device, transcribing a file with `startSeconds: 600` yields first-segment `startSeconds` ≈ 600 (not ≈ 0), and text matching the audio at the 10-minute mark.

## Phase 3 — Orchestrator: flush as you go, resume from the watermark

**File**: `src/transcription/book-transcription.ts` (+ `transcription-planning.ts` for the pure part).

1. `transcribeOneTrack` gains `startFromMs` and stops returning a buffered array. Its `addSegmentsListener` handler now:
   - maps the batch with `mapSegmentsToBookAbsolute` (unchanged),
   - **drops segments with `startMs < watermark`** — the rewind overlap, already stored,
   - `await appendTrackSegments(...)` with the batch's max `endMs` as the new watermark.

   Serialise these writes through a promise chain (a simple tail-await queue) so overlapping event batches cannot interleave transactions.

2. `runPendingTracks` passes `track.transcribedThroughMs` in, calls `completeTrack` when the file's promise resolves, and no longer calls `insertSegmentsForTrack`. Progress reporting should prefer the watermark over `currentFileFraction` where a resumed file would otherwise appear to restart at 0%.

3. Put the overlap-drop and watermark-advance rules in `transcription-planning.ts` as a pure function (e.g. `selectSegmentsAfterWatermark`) so they are unit-testable without SQLite or the native module.

4. Cancel: on `cancelRequested`, persist the last batch and leave the row `in_progress`. Resume then costs at most one flush interval (~2s of audio), not a file.

**Known accepted imprecision**: a segment straddling the watermark may be re-segmented differently on resume and dropped by the `startMs < watermark` rule, leaving a sub-second gap at a resume boundary. Acceptable for v1 — do not add reconciliation logic for it.

**Acceptance**: kill the app mid-file; on resume the transcript continues within a few seconds of where it stopped, with no duplicated or reordered segments. Existing `transcription-planning.test.ts` stays green; new tests cover the watermark selector.

## Phase 4 — Adaptive keep-awake + background flush

**Files**: `src/transcription/book-transcription.ts`, `src/native/book-transcriber/BookTranscriber.swift`, plus a small `src/transcription/transcription-wakefulness.ts`.

1. **Adaptive lock.** While `transcriptionStore.activeTask` is non-null, subscribe to `playbackStore` and maintain:

   | Transcription | Playback | Screen lock |
   |---|---|---|
   | active | `"playing"` | **released** — background audio keeps us alive, let the screen sleep |
   | active | anything else | **held** (`activateKeepAwakeAsync("book-transcription")`) |
   | none | — | released |

   Own this in the orchestrator's task lifetime, **not** in a screen. `useKeepAwake` inside `transcribe-controls.tsx` would release the moment the download sheet is dismissed. Release in `runPendingTracks`' `finally` so no path leaks the lock.

2. **Graceful background flush.** Add `beginBackgroundAssertion(): Promise<Int>` / `endBackgroundAssertion(Int)` to the native module, wrapping `UIApplication.shared.beginBackgroundTask(expirationHandler:)`. On `AppState` `"background"` while a task is active: take the assertion, await the pending flush, release it. ~30s is far more than a flush needs, and it converts "locked while paused" from a lost file into a lost couple of seconds.

3. **Copy.** The transcribe sheet should say what actually happens — transcription continues with the screen off while you're listening; if you stop playback it needs the screen on to keep going. Do not promise unattended completion until Phase 5 ships.

**Acceptance (release build — the dev client holds its own idle-timer tag, so keep-awake is unprovable there)**:
- start transcribing with playback running → lock the screen → transcription progresses, screen stays off;
- pause playback mid-transcription → screen stays awake and it keeps going;
- resume playback → screen is allowed to sleep again;
- background the app while paused → progress is persisted to the pause point.

## Phase 5 — BGProcessingTask (built; scope narrowed, see below)

At ~25× realtime a single 3-minute background window transcribes roughly an hour of audio, so a 12h book is ~10 windows — an overnight job on a charger. This is the App Store legal way to finish with the phone in a pocket, and it is only viable because Phases 1–3 make the work resumable at second granularity.

Two routes. **Prefer the native one**: expiration handling is the entire requirement here, and it is precisely what the JS-task wrapper abstracts away.

- **Native `BGTaskScheduler`** (recommended): register the identifier in `BookTranscriber`'s module init, add `UIBackgroundModes: processing` and `BGTaskSchedulerPermittedIdentifiers` via a `./plugins/with-transcription-background` config plugin (mirroring `with-carplay`). The `expirationHandler` cancels the analyzer and flushes, then reschedules.
- **`expo-background-task`** (spike only): faster to stand up, but the JS handler gives weak control over expiration.

Constraints to design around: scheduling is opportunistic (typically charging + locked + idle; you cannot request "now"), windows are minutes and terminable with seconds of grace, and `BGProcessingTaskRequest.requiresExternalPower` should be `true` for a job this heavy.

### What was built

The native route, as recommended. Files:

- `src/native/book-transcriber/BookTranscriptionBackgroundTask.swift` — the coordinator: launch-handler
  registration, `BGProcessingTaskRequest` submit/cancel, window adoption, expiration.
- `plugins/with-transcription-background.js` — `processing` appended to `UIBackgroundModes`, the
  identifier added to `BGTaskSchedulerPermittedIdentifiers`, and the registration call injected into
  `AppDelegate.didFinishLaunchingWithOptions`. Registered in `app.json`.
- `src/transcription/transcription-background-task.ts` — the JS controller, split pure-decisions /
  effects the way `transcription-wakefulness.ts` is.

**Registration cannot live in the Expo module.** `BGTaskScheduler.register` must be called before
`didFinishLaunchingWithOptions` returns, and an Expo module's `OnCreate` fires far too late: Expo
builds its `AppContext` — and every `ModuleHolder`, which is what posts `.moduleCreate` — inside
`EXReactNativeFactory host:didInitializeRuntime:` (`node_modules/expo/ios/AppDelegates/ExpoReactNativeFactory.mm`),
on the JS thread, after that method has returned. Hence the `withAppDelegate` mod. Inline modules
under `src/native/` are compiled straight into the app target (a `PBXFileSystemSynchronizedRootGroup`),
so the coordinator is visible to `AppDelegate.swift` with no extra project wiring.

### Scope: a live process, not a cold launch

**A window granted to a terminated app is declined**, rescheduled, and completed immediately. Only a
window granted while the process is alive-but-suspended is adopted.

This is a deliberate narrowing, not an oversight. `docs/carplay-debugging-log.md` (Attempt D) proves
that in a headless launch on this app JS `setTimeout` never fires and one missed event hangs a promise
forever; and the launch handler runs before the JS runtime exists at all (see above). Driving a
multi-minute transcription plus SQLite writes through a runtime in that state is not something this
codebase can currently claim. The decline path is not wasted: it leaves a request behind, and by then
the process is running, so the next grant lands on the case that works.

Widening to a cold launch later means proving, on a device, that the JS orchestrator boots and runs to
completion in a background launch. Do not assume it; the CarPlay log is the cautionary tale.

### The headless-timer landmine this had to fix first

`drainPendingSegmentEvents` was `new Promise(resolve => setTimeout(resolve, 250))`, awaited in
`transcribeOneTrack`'s `finally`. Under a background launch it would never resolve — the run would hang
holding a background assertion until iOS killed the app. It is now ended by a native event: native
emits `onFileFinished` as the last thing it does on every path, after its final flush, on the same
channel as `onSegments`. The 250 ms remains only as a build-mismatch backstop, armed after the promise
settles and checked on incoming events.

### Verifying it by hand

iOS grants processing windows opportunistically; you cannot request one. To force one, run a debug
build from Xcode, pause the debugger just after launch, and:

```
e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.markmccoid.laabs-audio.transcription"]
```

then continue. `_simulateExpirationForTaskWithIdentifier:` exercises the expiration path. Both require
a real device for the transcription itself — the simulator cannot run `SpeechAnalyzer`.

Native breadcrumbs are os_log, subsystem `laabs.transcription`, category `BackgroundTask`:
`register handler … ok=`, `scheduled earliestBegin=`, `window adopted/declined/expiring/completed/force-completed`.

---

## Device verification matrix

Simulator cannot run `SpeechAnalyzer` (`SpeechTranscriber.isAvailable === false`), so every row needs a physical Apple-Intelligence-capable iOS 26 device, and the keep-awake rows need a **release** build.

| # | Scenario | Expected |
|---|---|---|
| 1 | Transcribe with playback running, screen locked | Runs to completion; screen stays off |
| 2 | Transcribe with nothing playing | Screen stays awake; runs to completion |
| 3 | Pause playback mid-transcription | Lock is taken, screen wakes, work continues |
| 4 | Resume playback | Lock released, screen may sleep, work continues |
| 5 | Force-quit mid-file, reopen, resume | Continues within seconds of the kill point; no duplicate segments |
| 6 | Cancel mid-file, resume later | Same as #5; row stayed `in_progress` |
| 7 | Single-file M4B, 10h+ | Memory stays flat (no whole-book segment array); no jetsam |
| 8 | Resumed transcript, Read-Along at a resume boundary | No duplicate/overlapping segments; at most a sub-second gap |
| 9 | Upgrade v6 → v7 with an `in_progress` transcript | Opens cleanly; pending track restarts from 0 |
| 10 | Playback audio quality during transcription | No stutter on the oldest supported device |

## Risks

1. **`AnalyzerInput` presentation-time API** — the one unverified SDK detail (Phase 2). Fallback is a time offset in `serializeResult`; either way the JS contract holds.
2. **Background-audio CPU watchdog** — iOS can terminate a background-audio app for sustained heavy CPU. Not observed on the dev device, but scenario #7 is the one to watch. Phases 1–3 make a termination cheap rather than catastrophic.
3. **Resume-boundary recognition quality** — cold-start degradation for the first sentence after a resume. Mitigated by the 5s rewind; visible only on a heavily interrupted transcript.
4. **Watermark write amplification** — a transaction every ~2s for tens of minutes. Expected to be trivial against SQLite, but confirm no playback jank on scenario #10.
