# Listening Position hardening implementation plan

Status: implemented in the working tree, verified 2026-09-27; physical-device acceptance delegated to the user. Based on the reproduced failures in `streaming-interruption-analysis.md` and the user's single-file streamed audiobook incident. This plan does not claim that the historical device failure has been fully traced. Production implementation is now in this working tree. See `listening-position-hardening-verification.md` and ADR-0041 for the resulting contract and verification limits.

## Objective and acceptance contract

Preserve the user's Listening Position through audio interruptions, failed streaming recovery, delayed JavaScript events, app suspension, process termination, and restart. Fix truthful player state alongside recovery, without making durable saving depend on server reachability.

The enforceable guarantees are:

- A successfully committed native Listening Position remains recoverable after killing and restarting the process. Neither loading, a failed resume, server-sync completion, nor reading the record may erase it.
- Native capture works while JavaScript is suspended or receives no audio events. During healthy native scheduling, checkpoint once per second of wall-clock playback. The abrupt-kill exposure target is one sample interval plus measured commit latency, multiplied by Playback Rate for book-time loss; it is not an unconditional one-book-second guarantee.
- Interruption, explicit pause, seek completion, track/source switch, natural completion, and teardown request an immediate checkpoint. Ownership cannot be transferred or cleared until its required save has committed. For system suspension, retain the previous committed checkpoint even if the final write cannot complete.
- An older automatic sample cannot move a trusted Listening Position backward within the same position revision. Intentional seeks, skips, Play from Bookmark, Auto Rewind, and unread changes may move it backward by creating a new revision.
- Startup Active Playback Restore remains paused. A repaired save must survive a second kill before the user presses Play.
- Playback status reflects native transport state. A requested resume is not proof that playback has started or is advancing.
- Owner changes, temporary playback, and stale asynchronous completions cannot update the wrong playable's Listening Position.

Literal zero loss between an unsampled instant and an immediate device failure is not a realistic guarantee. The release contract is to retain every committed checkpoint, bound normal sampling exposure, and eliminate the tens-of-minutes recording gap observed here. Storage failures must be visible and diagnosed; they must never be silently treated as successful saves.

## Design decisions

### A. Native recovery storage is permanent local evidence

Add a small native Listening Position module rather than distributing additional save logic through player callers. On iOS, put its implementation in the local AudioPro module, with a Swift SQLite adapter and an injected in-memory adapter for deterministic tests. Keep the pure ownership/order/recovery rules separate from AVPlayer and the React Native bridge.

Use a dedicated SQLite database in Application Support, separate from the app's query/projection database. Configure WAL with `synchronous=FULL`, validate those settings when opening, and link `sqlite3` in `AudioPro.podspec`. Use one native writer queue. Do not copy the existing Expo SQLite projection database or open it with competing migration ownership.

This storage choice provides an explicit transaction commit receipt and supports atomic ordering and command updates. SQLite documents durable WAL commits with FULL synchronization. [SQLite synchronous settings](https://sqlite.org/pragma.html#pragma_synchronous).

Configure file protection so storage remains accessible for locked-phone playback after the first unlock; verify the database, WAL, and SHM files on hardware. Do not relax protection to unrestricted access. [Apple file protection](https://developer.apple.com/documentation/foundation/fileprotectiontype/completeuntilfirstuserauthentication).

Capture AVPlayer values on its control queue; persist immutable samples on the writer queue. Do not introduce disk waits on the main thread. Keep at most one periodic write in progress and coalesce superseded periodic samples. Immediate command/interruption saves have priority over periodic work. Use a short, correctly ended background task around final background writes, with expiration handling; it is additional execution time, not a durability guarantee. [Apple background execution](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time).

The ledger retains its latest committed record after projection or server acknowledgement. Acknowledgement records which sequence has been applied/synced; it does not delete the Listening Position. A new committed revision supersedes an old one. Remove the six-hour expiration as a loss-of-position rule; use identity, revision, and explicit supersession to determine applicability.

Initial record shape:

```ts
type ListeningPositionRecord = {
  schemaVersion: number;
  ownerId: string;             // Audiobookshelf User Identity
  libraryItemId: string;
  episodeId: string | null;
  playbackGeneration: number; // native allocated; increases on ownership changes
  positionRevision: number;   // native allocated; increases on intentional relocation
  sequence: number;           // native allocated; total order for committed local changes
  positionMs: number;         // whole-playable position
  trackPositionMs: number;
  trackStartOffsetMs: number;
  trackIdentity: string;
  durationMs: number;
  isFinished: boolean;
  reason: string;
  capturedAt: number;         // diagnostics only; not local ordering authority
  committedAt: number;
  projectedThroughSequence: number;
  syncedThroughSequence: number;
};
```

Use the existing canonical Audiobook Identity lookup/alias rules; do not derive identity from a URL containing credentials. An Episode is keyed with its parent item and episode id. The owner is frozen when playback is assigned, rather than looked up from current authentication when a delayed event arrives. Server Connection Endpoint is routing metadata, not the owner key.

### B. Give callers one interface for resolution and relocation

App-facing operations should stay small:

- Resolve a playable's saved Listening Position before selecting its track.
- Load an owned playback generation and return the **confirmed applied position**, generation, revision, and commit receipt.
- Relocate the Listening Position with an explicit command id and reason, returning a confirmed result.
- Read a live native snapshot for foreground reconciliation and recovery. This must read AVPlayer/native state, not AudioPro's current JavaScript `getTimings()` cache.
- Acknowledge a specific sequence projected/synced, conditional on identity and order.

The native module handles automatic sampling, immediate boundary saves, sequence allocation, supersession, and stale-write rejection internally. The app does not issue one durable bridge write for every progress tick.

Model saved position separately from transient UI, Playback Control Intent, Streamed Playback Session, and server-sync acknowledgement. Keep existing Progress Sync Intent behavior behind Listening Position Sync. A native periodic checkpoint must not automatically turn each streamed interval sync into a direct-progress update and lose session listening-time accounting.

### C. Order events explicitly; do not use “largest position always wins”

Every status, seek result, load result, and sync completion carries playable identity, playback generation, position revision, and sequence where applicable. Require exact ownership before applying it. Within a revision, reject invalid/transient backwards position samples; still process valid transport-state changes.

Intentional relocation uses a command journal:

1. Commit a relocation request referencing the current revision and requested target. Do not replace the confirmed Listening Position merely because a slider moved optimistically.
2. Seek/load using that command id and a new revision; reject late samples from its predecessor.
3. On confirmed seek completion, commit the applied native position and make the new revision authoritative.
4. On failure or process termination before confirmation, restore the last confirmed position. Retry the requested command only as explicit policy; do not silently claim it completed.

Mark unread/finished is an explicit local state command and does not need an audio seek to be valid. Auto Rewind uses a recorded command id so restart/retry does not apply the same rewind twice. Native lock-screen skip/seek commands must participate even when JavaScript is unavailable. Existing Skip Burst accumulation continues to settle as one relocation.

A current unresolved local explicit command takes precedence over older high-position cache/snapshot candidates. Rebase the derived projections to the confirmed revision so an old 45:00 CarPlay snapshot cannot undo a deliberate rewind to 3:00. Projection writes across SQLite/MMKV are not assumed atomic: restart replays projection from the authoritative record idempotently.

Fresh server progress remains a Resume Resolution candidate under the existing multi-device policy when no newer unresolved local intent applies. Do not invent a global ordering guarantee across devices that Audiobookshelf does not provide. Explicit local changes, stale server echoes, and genuine other-device advancement need separate tests and documented resolution rules.

### D. Keep playback intent separate from observed transport state

The native interruption state tracks the owning generation, an active interruption episode, whether the user wanted playback, and whether the user paused/cancelled during it. Repeated begin notifications must not overwrite resume permission from a zero-rate sample. Missing end/options must preserve saved position and leave playback paused; they must not force an unsolicited resume.

Observe AVPlayer `timeControlStatus`, item failures, playback-stalled notifications, route changes, and media-services resets. Carry native state and transition reason through the adapter instead of representing loading, error, idle, and track completion as one `isPlaying: null` value. Keep natural file advancement distinct from an external pause.

Use the existing `loading`, `paused`, `playing`, and `error` display states initially. Add a transition reason for interruption, buffering, source replacement, and natural completion. This does not require adding `starting`/`pausing` states or redesigning Playback Control Intent.

Only publish PLAYING when transport reports playing; also verify progress advancement to settle startup/recovery successfully. Time-control state cannot prove physical sound output, but it gives a materially stronger contract than a call to `play()` or a nonzero requested rate. Deadlines use a native monotonic clock so suspended JavaScript timers do not govern recovery.

## Implementation sequence

Each stage is independently reviewable, with its own pass/fail gate. Preserve unrelated current working changes. If an isolated implementation checkout is needed, use a managed worktree. Do not commit deliberately failing diagnostic files as regression tests. When creating commits, add tester-facing entries to `NEW_FEATURES.md` as required by repository instructions.

### 1. Fix current data-loss races and interruption bookkeeping

Commit intent: `fix(player): preserve interruption position through recovery`

Changes:

- Turn the existing same-track recovery read into peek plus conditional acknowledgement; do not clear it on activation/play requests. Retain it through failed activation, stalled play, failed seek, and paused restore.
- Capture interruption position whenever an owned live player has meaningful position, even when rate is already zero. Snapshot resume intent before modifying it; handle duplicate notifications and user pause.
- Make `AudioEngine.load` return the confirmed applied position. Include a native load/generation id in ready/seek completion results. Do not consider a setup PAUSED-at-zero event proof that the requested seek has finished.
- Update both `loadTrack` and provisional session commit to persist the confirmed native position. Prevent an earlier request or stale load completion from replacing a newer accepted position. Do not use `Math.max(requested, returned)` as the general fix; that would break intentional backward seeks.
- Preserve the current old-format record while the new ledger is being developed. Stop calling the current UserDefaults write a synchronous disk guarantee.

Files: AudioPro.swift, AudioPro.mm, module TypeScript types/emitter/bridge, audio-engine.ts, player-service.ts.

Gate: the 45:00 → 3:00 overwrite, already-zero interruption, failed-activation retention, and paused-restore-second-kill contracts pass. Failure to confirm initial seek leaves a saved position intact and a usable stopped/error state. Existing file-transition, provisional-start, and temporary-playback tests still pass. This stage reduces known risk but is not the complete durability release.

### 2. Introduce the native ledger and actual persistence tests

Commit intent: `feat(player): persist owned listening positions natively`

Changes:

- Add Swift record/storage/rule modules and the SQLite adapter; inject clock and storage into their test interface.
- Add generation/revision/sequence allocation and compare-and-apply writes in the same transaction. Fence old queued captures before new ownership begins.
- Capture once per second natively, independently of JS listener presence; checkpoint immediately at the specified boundaries. Temporary previews and ambient tracks do not alter the normal Listening Position.
- Emit explicit commit receipts/failures. Monitor commit latency and capture-to-commit age with monotonic time. Start performance targets at p95 <100 ms and no sustained backlog above two sample intervals under healthy storage; measure on supported hardware and adjust documented thresholds rather than weakening durability silently.
- If initial storage cannot open/commit, do not begin new unprotected playback. If persistence fails during listening, preserve the last committed record, pause safely, and surface a clear saving error once the UI can receive it. Never reset the saved position as an error fallback.

Gate: a separate process writes through the real Swift SQLite adapter, reports a successful commit, is killed, and another process recovers exactly that sequence/position. Kill before commit returns a valid previous record. Inject busy/full/I/O errors, corrupted input, and device-locked access. The storage API never reports success before COMMIT and never deletes good evidence on failure. Long background audio with JS delivery disabled continues committing positions. Measure write cost/battery/WAL growth; keep maintenance off the playback-critical path.

### 3. Integrate Resume Resolution, explicit changes, and identity

Commit intent: `fix(progress): resolve playback from committed listening position`

Changes:

- Read the owner-scoped native record before any queue/reset/provisional writes; resolve whole-book position before file selection.
- Route resume, explicit seek/skip/bookmark, Auto Rewind, unread/finished, source replacement, and native remote commands through the generation/revision rules.
- Reject earlier events and load results after a relocation or book/owner change. Process playback state even when rejecting an invalid position.
- Replay checkpoint projection into MMKV progress/playback snapshots and Episode progress at startup/foreground reconciliation, with sequence-conditional acknowledgement after those durable writes complete. React Query, SQLite browse projections, and Displayed Listening Position remain derived views.
- Retain per-owner evidence on logout. Freeze/end the previous generation before activating another owner. A new owner can only resolve its own record. Revisit owner stamping on the saved startup book pointer rather than relying solely on teardown for this new native store.
- Migrate old MMKV progress conservatively and idempotently. Preserve unscoped legacy UserDefaults recovery evidence; import only when its owner/track association is provable. Otherwise quarantine it for diagnostic/manual recovery, rather than assigning it to whoever is currently signed in or deleting it.

Gate: kill before/after each relocation journal step, restart paused, then kill/restart again. Deliberate rewind remains rewound; old ticks, old cache values, failed seeks, and a second Auto Rewind cannot change it. Cover single-file, cross-file, Episode, bookmark preview, Skip Burst, source fallback, logout/switch, and same identity through a different endpoint.

### 4. Make transport state and interruption recovery truthful

Commit intent: `fix(player): reconcile interruption and buffering states`

Changes:

- Preserve full engine state and reason in `AudioEngineStatus`; update display/control/CarPlay/widget projections consistently.
- Remove the unconditional interruption-end PLAYING emission. Wait for native playing state, then verify movement for startup/recovery confirmation.
- Keep pause and failure handling independent of resume-floor position rejection. Zero/invalid samples cannot erase position and cannot suppress PAUSED/ERROR.
- Add generation-scoped native observation/deadline handling. Capture progress before error teardown, route loss, or media-services reset. Restore from the ledger after player recreation.
- Do not let rate reconciliation restart audio while paused/interrupted, and do not hold Playback Control Intent on remote progress sync.

Gate: the remaining state diagnostics pass. At 1x and faster rates, distinguish requested play, buffering, playing, interruption, user pause, failure, and natural track advancement. No indefinitely playing UI after failure or stalled recovery. Observer cleanup leaves one active observer set and stale callbacks cannot affect a replacement player.

### 5. Bound streaming recovery and protect sync ordering

Commit intent: `fix(streaming): recover stalled playback at saved position`

Changes:

- Add one generation-scoped recovery attempt. Initial policy: native five-second no-movement observation triggers a stalled state; attempt at most two source rebuilds with increasing delay inside a 30-second recovery budget. Validate thresholds on slow/mobile connections. Long buffering is visible immediately; retry limits prevent session churn.
- Classify interruption/session activation, buffering/network, source-authentication/session expiry, and fatal item failure. Refresh credentials only when justified; rebuild source/session once per attempt with the committed position. Avoid speculative parallel sessions and uncontrolled refresh loops.
- Keep old progress evidence before closing/replacing a stream. Session close is best-effort and cannot zero/overwrite progress. A user pause, different playable, owner switch, or superseding command cancels the attempt before any restart can become audible.
- Foreground reconciliation reads the live native snapshot and ledger even if JS missed every interruption event. Network recovery never controls whether local saving succeeds.
- Serialize/coalesce sync per owner/playable. Carry the checkpoint/command sequence through requests. An older response cannot clear newer intent, advance its sync acknowledgement, or overwrite local projections. Capture the owner/endpoint used by an attempt and reject unsafe routing after an account switch.
- Keep streamed-session time-listened reporting; do not queue every native sample into the existing direct-progress path. On restart or a failed/coarse sync, import the newest unsynced record into the existing Progress Sync Intent mechanism. Remote state may temporarily lag local state; retry the newest intent and never erase local evidence because the server accepted an older request.

Gate: network blackhole, lost connection on interruption end, closed session, expired token, transient recovery, and permanently unreachable server. The app resumes at the committed position when recovery succeeds; when it fails it remains stopped with that position retained. Pause/owner/book switch during each awaited step prevents late audible restart. Overlap sync with seek/unread and verify newest local intent survives.

### 6. Implement Android parity and verify fallback contracts

Commit intent: `feat(android): retain native listening positions across focus loss`

Changes:

- Implement the same record/order/receipt contract with native Android SQLite in the AudioPro playback service. Capture focus-loss/pause/buffering/error/task removal before release; keep periodic sampling independent of JS listeners.
- Read actual Media3 playing/buffering/suppression state rather than assuming playWhenReady means audible playback. Reuse the TypeScript Resume Resolution and recovery contract.
- Keep native bridge/types supported across iOS, Android, and web. A missing method must not silently masquerade as durable capture. Web can retain its existing persistence with a explicitly narrower durability capability.

Gate: Android focus interruption, JS-disabled playback, service recreation/process kill, and task removal recover the newest committed position. Shared TypeScript changes pass tests on both native platforms. An iOS-specific release may ship before Android parity only with its platform scope explicit; do not claim universal native durability until both implementations pass.

### 7. Ship with a regression and hardware release gate

Commit intent: `test(player): cover interrupted playback and process recovery`

Changes:

- Promote relevant diagnostic contracts into normal regression suites using the real new module interface. Retire source-extracted Swift simulation once the same behaviors are tested through that interface; keep the original scenario represented.
- Add seeded event-order tests that combine interruptions, JS suspension, load/seek results, kill/restart, and sync replies. Inject failure at every irreversible step and assert identity, ordering, recovery position, and transport state after each transition.
- Record a small always-on native diagnostic ring: generation/revision/sequence, sampled and committed positions, native transport reason, save errors, and interruption/recovery results. Never log tokens, authenticated source URLs, or notification content. Optional detailed Progress Logs can remain opt-in.
- Expose concise diagnostic export with capture/commit age, failed-write count, and resume candidate selection. Diagnostics must not become another expensive per-tick persistence workload.
- Update CONTEXT, the playback/progress docs, AudioPro change documentation, and ADRs. Verify a newly built native development/TestFlight binary; an OTA JavaScript update alone cannot deliver native changes.

Gate: focused regression suites and actual-storage kill tests pass, followed by applicable app/module lint/type/build checks. Run the hardware matrix below with no unexplained position regression or stuck-playing state. Fix failures before expanding rollout. For module-wide `check` requirements, report any pre-existing tool/dependency limitations separately from change failures.

## Hardware release matrix

| Scenario | Required outcome |
| --- | --- |
| Single-file stream, start 3:00, screen locked, AirPods announcement near 45:00 | Resume near interruption position; state follows actual transport; saved native record near 45:00 |
| Same scenario, force quit immediately after announcement | Restart paused at the newest committed checkpoint, not 3:00 |
| Restart paused, force quit again without pressing Play | Same recovered position survives |
| Native playback continues while JS event delivery is disabled | Native checkpoint advances; reconnect/restart recovers it |
| Network unavailable during announcement/end/recovery | Bounded recovery; stopped/buffering UI; preserved local position |
| Explicit pause during Siri/announcement or retry | No automatic audible restart |
| Repeated interruptions, missing end, Bluetooth disconnect, route change | Intent remains consistent and progress survives; no duplicate recovery |
| Native item failure or media-services reset | Capture survives teardown; recreated player resolves committed position |
| Backward seek, bookmark, chapter/skip burst, Auto Rewind, unread | Deliberate relocation survives; older high-position events/caches do not undo it |
| Cross-file transition, downloaded/streamed fallback, temporary preview | Correct whole-book checkpoint; preview never replaces normal Listening Position |
| Book switch, owner switch, endpoint switch, Episode playback | Old async work cannot affect the new owner/playable; same owner retains data |
| Storage full/busy/I/O failure, lock-state access, real kill at COMMIT | Last good record remains; failed save is explicit; no false success receipt |

Test at 1x and at the supported maximum Playback Rate; include an ordinary 45–60 minute locked-phone streaming run with clean connectivity as a baseline. Repeat announcement timing cases rather than relying on one successful text. Automation checks positions/state; actual AirPods notification behavior requires hardware validation.

## Architecture records to update

- ADR-0005: retain durable-before-network Progress Sync Intents; document native ledger as independent capture evidence, with sequence-aware synchronization.
- ADR-0007: strengthen provisional streamed start confirmation to include applied position and progress movement while retaining startup budget/cleanup behavior.
- ADR-0012: preserve separate Playback Control Intent; do not lock controls on server sync. Local durability acknowledgement belongs to save/ownership handling, not a network wait.
- ADR-0013: keep Displayed Listening Position derived; separate state processing from rejecting stale position samples.
- ADR-0015: scope every native record and delayed completion to the Listening State Owner.
- ADR-0021: explicitly revisit its decision to omit owner tagging for the saved startup pointer. The new independent native recovery store makes identity checks necessary in addition to teardown. This is an intentional design change to record in a new superseding ADR during implementation, not an assumed silent exception.

## Completion definition

The work is complete when every original relevant failure contract is green through supported module interfaces, committed positions survive real process termination, paused restoration cannot re-save an older request, deliberate backward movement remains correct, and the hardware release matrix passes. Production telemetry/export must distinguish a stopped player from a save failure and reveal any checkpoint gap. Neither a passing Jest suite nor one successful announcement is sufficient by itself.
