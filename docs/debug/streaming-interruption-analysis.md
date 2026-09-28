# Streaming interruption and lost listening position

Analyzed 2026-09-26 against the current checkout (HEAD `82940d2`, with existing unrelated working changes preserved). Reported scenario: a single-file streamed audiobook starts at 3:00, reaches about 45:00, an AirPods announcement interrupts it, audio does not return, the phone still shows a pause icon, and restarting returns to 3:00. User confirmed the latest build. This investigation adds diagnostic harnesses and this report; it does not change production playback behavior or create a commit.

**Conclusion:** there are reproducible defects in interruption capture, recovery-record retention, player-state reporting, and single-file restore bookkeeping. The exact historical incident is unconfirmed without its device trace. The 42-minute loss cannot be attributed to the five-minute sync interval alone: accepted JavaScript status updates persist locally independently of server sync.

## Normal pathway and existing protections

1. `loadBook` obtains a streamed session, builds a source containing the current access token, and resolves a resume position from pending progress, saved playback, the per-book CarPlay snapshot, cached progress, and fresh server progress. A provisional start waits for the native PLAYING state before committing the session. These checks validate a native state event; they do not verify sustained streaming movement.
2. The native progress timer emits position every second. The audio adapter forwards it to `handleStatus`, which adds the file's offset and calls `applyStatusUpdate`. The Zustand persistence middleware writes `positionMs` to MMKV on accepted updates. **This is independent of the network.** The diagnostic confirms an accepted 45:00 sample is saved and selected for resume.
3. Server sync is attempted every five minutes based on incoming playing events and elapsed time, rather than a separate five-minute timer. Pause, seek, close, background, and external pause record a durable MMKV progress intent before remote sync. Interval sync records an intent on failure; it also writes a CarPlay snapshot before its remote request. A pending or offline remote request should therefore not, by itself, explain returning all the way to 3:00.
4. On interruption begin, native code currently decides whether it was playing by inspecting `player.rate`. Only when that value is nonzero does it pause, save a native record, and emit PAUSED. JavaScript then saves the accepted position and initiates external-pause sync.
5. On interruption end, native code checks remembered playback intent and Apple's `shouldResume` hint, consumes its saved position, reactivates the audio session, requests playback, and emits PLAYING.
6. Restart restoration loads the last audiobook paused. Native `play` can raise its initial position using the interruption record; JavaScript separately tracks the requested initial position.

Relevant entry points: [interruption handler](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/modules/react-native-audio-pro/ios/AudioPro.swift:402), [native progress timer](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/modules/react-native-audio-pro/ios/AudioPro.swift:540), [status handling](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/player/player-service.ts:3968), [saved playback fields](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/player/playback-store.ts:314), [progress sync](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/progress/listening-position-sync.ts:215).

## Confirmed defects, ordered by relevance

### 1. An already-paused player skips interruption capture and recovery intent

At AudioPro.swift:414, `wasPlayingBeforeInterruption = player?.rate != 0` samples the instantaneous rate after the interruption notification arrives. Apple documents that AVPlayer automatically pauses in response to interruptions. The order in which that pause and our notification handler execute must not determine whether we preserve progress.

With a live player at 45:00, `shouldBePlaying == true`, and `rate == 0` when begin is handled, the actual handler:

- Creates no interruption record.
- Emits no PAUSED event.
- Sets `wasPlayingBeforeInterruption` to false, preventing automatic resume even when end contains `shouldResume`.

This is a strong explanation for intermittent announcement recovery. It also removes the native recovery fallback if JavaScript's last saved position is stale. It does **not**, alone, prove why ordinary progress updates had not saved the preceding 42 minutes. Nested begin notifications can likewise overwrite remembered intent with a zero-rate sample.

Source: [Apple: Handling audio interruptions](https://developer.apple.com/documentation/AVFAudio/handling-audio-interruptions).

### 2. The native recovery record is deleted before recovery succeeds

`consumeInterruptionResumePosition` removes the record when read. At interruption end it is consumed **before** `setActive` can throw, playback can stall, or a corrective asynchronous seek can complete. The deterministic native harness confirms a failed activation and a stalled resume both discard the 45:00 record.

Reload also consumes the record before the new item finishes loading. A failed load, paused startup restore, or another process termination can leave no native record for the next retry. The six-hour expiration is a further recovery limit, though it is unlikely to explain an immediate restart.

### 3. Single-file restoration can overwrite recovered 45:00 with requested 3:00

Native `play` applies the saved interruption floor to its pending start time. Its ready/seek status can reach JavaScript at 45:00 before `engine.load` resolves. After the await, [loadTrack](/Users/markmccoid/Documents/myProgramming/ReactNative/laabs_audio/src/player/player-service.ts:3930) unconditionally writes the **requested** initial position, 3:00, back into the persisted playback store.

The diagnostic exercises the actual service method: storage contains 45:00 inside the load callback, then contains 3:00 after `loadTrack` returns. A later progress tick may correct it, but a paused restore has no regular playing ticks. A subsequent kill or load failure can therefore lose the recovery position again. The provisional autoplay commit also writes its requested position, so it needs the same ownership rule.

This affects the user's confirmed single-file configuration. It can explain a misleading restored position and a second loss after recovery; without device timings it is not proof that the original 42-minute recording gap arose here.

### 4. The pause icon does not reliably mean audio is moving

- The interruption end handler emits PLAYING immediately after requesting `play`, without confirming actual transport state or progress movement.
- The native player observes `rate` and item readiness, but not `timeControlStatus` or explicit playback-stalled notifications. Apple distinguishes playing from waiting for sufficient media data using `timeControlStatus`.
- The audio adapter maps LOADING and ERROR to `isPlaying: null`. `handleStatus` only changes a playing UI to paused for `isPlaying === false`. The diagnostic confirms both LOADING and ERROR leave the public state at playing. The engine error callback sets an error message without correcting playback state.
- The below-resume-position guard returns before processing playback state. A stale or zero position on a PAUSED event therefore suppresses both the UI pause and external-pause sync. The diagnostic confirms this with a saved 3:00 floor and a zero-position pause.

Natural STOPPED events must still allow seamless file transitions; simply mapping every non-PLAYING event to a user pause would break that behavior. The adapter needs to preserve the reason/state, rather than compress all these states to null.

Source: [Apple: Controlling the transport behavior of a player](https://developer.apple.com/documentation/avfoundation/controlling-the-transport-behavior-of-a-player).

### 5. There is no continuous native checkpoint independent of JavaScript

`sendProgressNoticeEvent` emits a position and updates system metadata; it does not retain a recovery checkpoint. If native audio continues while JavaScript events are undelivered, frozen, or rejected, the normal MMKV save, interval sync, and background snapshot can all remain at an earlier point. The background snapshot reads JavaScript's store and does not sample AVPlayer directly.

The native harness confirms a 45:00 progress tick creates no recovery record. This shows the missing fallback, **not evidence that JavaScript actually stopped receiving events in this incident**. The return exactly to the starting 3:00 makes event delivery/acceptance and stale-position overwrites particularly important to trace.

The existing interruption save is also weaker than its comment claims: `UserDefaults.set` updates memory immediately and writes to disk asynchronously. The harness uses a storage double and cannot establish physical disk durability. [Apple: UserDefaults](https://developer.apple.com/documentation/foundation/userdefaults).

## Other streaming risks

- Receiving a text does not establish that the Audiobookshelf server or its audio URL was reachable. Buffered audio can continue through connectivity changes and then stall when playback resumes or more data is needed.
- Audio URLs/headers contain the token captured at queue construction. AVPlayer networking does not go through the app's authenticated-fetch refresh path. There is no announcement-resume source rebuild to replace an expired token or closed streamed-session URL. These are plausible stall triggers, not confirmed causes here.
- Missing interruption-end notifications or a missing `shouldResume` hint can legitimately prevent automatic recovery. The saved position still needs protection regardless. Respect explicit user pauses; do not resume blindly. [Apple: shouldResume](https://developer.apple.com/documentation/AVFAudio/AVAudioSession/InterruptionOptions/shouldResume).
- The current native record only matches a track id and contains a file-relative position, with no listening-owner scope or whole-book offset. Cross-file reload is a known gap, but the user's single-file confirmation rules it out for this incident. Identity scoping remains relevant to a future checkpoint design.
- Auto rewind is limited to at most five minutes by current rule normalization, so its configured behavior does not explain a 42-minute jump.

## Recommended repair order

1. **Make native position capture the recovery authority.** Save a scoped whole-book checkpoint independently of JavaScript/network access, periodically and immediately at interruption, pause, stall/error, and teardown boundaries. Use a persistence mechanism with a defined committed-write contract; document the maximum interval exposure rather than promising zero loss under any possible device failure.
2. Capture interruption position even if rate is already zero. Derive resume permission from durable user playback intent, handle nested notifications, and keep explicit pause authoritative.
3. Peek at recovery records; acknowledge them only after the recovered position has been committed into the app's durable listening state. Keep the record through failed activation, stalled playback, failed seek, and paused startup restore. An intentional backward seek must explicitly supersede it so a legitimate rewind is not undone.
4. Resolve the checkpoint **before** choosing a track or committing a session. Make engine load return/confirm the applied initial position. Never overwrite an accepted recovered position with the earlier request after an await.
5. Preserve native transport states in the adapter; process state independently from rejecting stale position samples. Observe waiting/playing/paused state and detect sustained lack of movement. A stream reconnect should resume from the saved checkpoint with fresh credentials, bounded retries, and a visible stopped/buffering state on failure.
6. Add compact persisted diagnostics for native checkpoint creation/acknowledgement, interruption intent and rate, transport state, event delivery timestamps, and resume candidates. Avoid logging tokens or source URLs. Existing Settings Progress Logs are opt-in and do not capture every native boundary.

Required acceptance cases: locked phone with AirPods announcement; player already at rate zero when begin arrives; slow/lost connectivity at announcement end; JS delivery disabled while native playback continues; repeated interruptions; immediate kill before/after activation and checkpoint acknowledgement; paused startup restoration followed by a second kill; explicit backward seek; owner change; and one-file versus multi-file books. Resume must use the most recent committed listening position, except deliberate seek/rewind/unread actions.

## Runnable evidence

Native path (extracts current Swift method bodies and compiles them with deterministic player/session/storage doubles; no device, network, or preferences writes):

```sh
python3 scripts/diagnose-ios-streaming-interruption.py
```

Result: three controls pass; seven safety checks fail: capture, state publication, and resume intent when already paused; independent native checkpoint; record retention after activation failure; truthful state and record retention after stalled resume. Exit 1 is intentional while these defects exist.

App path (actual audio adapter, service methods, Zustand persistence, and resume selection with an in-memory MMKV double):

```sh
npx jest --watchman=false --runInBand --runTestsByPath src/player/streaming-interruption.diagnostic.ts --testMatch '**/*.diagnostic.ts'
```

Result: three controls pass; four safety checks fail: LOADING state, ERROR state, below-floor PAUSED event, and 45:00 → 3:00 restore overwrite. The `.diagnostic.ts` suffix keeps these deliberately failing contracts outside the normal test suite. Run explicitly when repairing them, then promote appropriate cases into regression tests.

Existing related checks:

```sh
npx jest --watchman=false --runInBand src/player/playback-store.test.ts src/player/player-service.track-transition.test.ts src/player/audio-engine.track-transition.test.ts src/progress/background-progress-routing.test.ts
```

Result: four suites, ten tests pass. These verify existing status persistence, natural file transitions, and background routing; they do not cover the real AirPods/iOS interruption timing. Physical-device validation remains necessary after implementation.

## Implementation follow-up

The diagnostic findings above describe the code before hardening. The deliberately failing extracted-method harness has been retired; application contracts are now regular `src/player/streaming-interruption.test.ts` regressions, and production SQLite durability is exercised by `scripts/test-native-listening-ledger.py`. See `listening-position-hardening-verification.md` for current automated coverage and physical-device acceptance.
