# Android listening-position validation

The native ledger uses a dedicated Android SQLite database, WAL, and `FULL`
synchronization. Android 28+ configures synchronization through `OpenParams`;
Android 26/27 sets it on the writer connection. Every transaction verifies that
writer connection before changing records. Receipts leave the store only after
`endTransaction()` completes COMMIT. The custom corruption handler preserves the
database instead of Android's default delete-and-recreate behavior.

Sampling belongs to the playback service and does not depend on React Native
listeners. The service samples once per second and checkpoints focus loss,
buffering, pause, errors, completion, task removal, and release. Captures freeze
the owner and order metadata before entering the single writer. Periodic writes
cannot accumulate behind slow storage. Failed capture pauses playback, retains
the previous record, and reports a saving error.

The initial source position is assigned before prepare. Owned playback remains
paused until its initial position commits. Ready and seek-complete events then
carry the confirmed load id and generation/revision. Previews have scoped
transport leases with capture disabled; after normal playback is restored,
capture can be enabled again. Explicit state changes fence capture, and a late
capture-policy completion cannot enable another lease.

Run the Android SQLite instrumentation suite from the app's `android` directory:

```sh
./gradlew :react-native-audio-pro:compileDebugKotlin
./gradlew :react-native-audio-pro:connectedDebugAndroidTest
```

The tests use an isolated database and cover close/reopen twice, the 45:00 to
3:00 overwrite, generation fencing, pending and confirmed rewinds, rollback of a
failed write, command idempotence, acknowledgement ordering, inactive owners,
episodes, whole-book offsets, preview ownership, and invalid samples. Reopening
a helper is not a process-kill test. Separate hardware validation must cover a
real process kill/service recreation, task removal, focus interruptions, locked
playback, and JS suspension while the native ledger advances.

On the implementation host, Gradle could not start because no Java runtime was
installed; the Android SDK was also unavailable. The instrumentation suite has
therefore been added but not executed. Compile and run it in the configured
Android development/CI environment before releasing Android changes.

Stable `positionCommandId` values make initial Auto Rewind relocation retries
idempotent. Pending retries retain the original absolute target and revision;
confirmed or superseded retries resume from the newest committed record. An
acknowledgement advances only its projected/synced through watermark up to the
submitted sequence, so a newer local record remains unsynced.
