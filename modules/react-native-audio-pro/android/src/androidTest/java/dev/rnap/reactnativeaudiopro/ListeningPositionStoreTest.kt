package dev.rnap.reactnativeaudiopro

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Runs against Android SQLite itself; these are reopen tests, not a process-kill claim. */
@RunWith(AndroidJUnit4::class)
class ListeningPositionStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "audio-pro-position-test-${UUID.randomUUID()}.sqlite"
    private lateinit var store: ListeningPositionStore
    private val scope = ListeningPositionStore.Scope("listener-a", "book-a", null)

    @Before fun create() { store = ListeningPositionStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }

    private fun assign(relocate: Boolean = false, targetMs: Long = 180_000) =
        store.assign(scope, UUID.randomUUID().toString(), "file-a", 0, 5_400_000, relocate, targetMs)

    @Test fun receiptSurvivesCloseReopenAndPausedSecondReopen() {
        val owned = assign()
        store.capture(owned, 180_000, 5_400_000, "load-confirmed", confirmCommand = true)
        val committed = store.capture(owned, 2_700_000, 5_400_000, "focus-loss")!!
        repeat(2) {
            store.close()
            store = ListeningPositionStore(context, name)
            val restored = store.read(scope)!!
            assertEquals(2_700_000L, restored.getLong("positionMs"))
            assertEquals(committed.getLong("sequence"), restored.getLong("sequence"))
        }
        store.writableDatabase.rawQuery("PRAGMA synchronous", null).use { assertTrue(it.moveToFirst()); assertEquals(2, it.getInt(0)) }
        store.writableDatabase.rawQuery("PRAGMA journal_mode", null).use { assertTrue(it.moveToFirst()); assertEquals("wal", it.getString(0)) }
    }

    @Test fun staleRequestedStartAndOldGenerationCannotOverwriteInterruption() {
        val old = assign()
        val saved = store.capture(old, 2_700_000, 5_400_000, "interruption", true)!!
        val restored = assign()
        assertNull(store.capture(restored, 180_000, 5_400_000, "stale-load", true))
        assertNull(store.capture(old, 2_800_000, 5_400_000, "late-tick"))
        assertEquals(saved.getLong("sequence"), store.read(scope)!!.getLong("sequence"))
    }

    @Test fun pendingBackwardSeekLeavesConfirmedPositionAndFencesOldSamples() {
        val owned = assign()
        val saved = store.capture(owned, 2_700_000, 5_400_000, "periodic", true)!!
        val command = store.requestSeek(owned, 180_000, "rewind-command")
        assertNull(store.capture(owned, 2_701_000, 5_400_000, "queued-before-seek"))
        assertNull(store.capture(command, 180_000, 5_400_000, "unconfirmed-seek"))
        assertEquals(saved.getLong("sequence"), store.read(scope)!!.getLong("sequence"))
        store.close()
        store = ListeningPositionStore(context, name)
        assertEquals(2_700_000L, store.read(scope)!!.getLong("positionMs"))
    }

    @Test fun confirmedRewindSupersedesOldHighSamples() {
        val owned = assign()
        store.capture(owned, 2_700_000, 5_400_000, "periodic", true)
        val command = store.requestSeek(owned, 180_000, "rewind-command")
        val applied = store.capture(command, 180_000, 5_400_000, "seek-confirmed", true)!!
        assertNull(store.capture(owned, 2_701_000, 5_400_000, "stale-tick"))
        assertEquals(180_000L, applied.getLong("positionMs"))
        assertNotNull(store.capture(command, 181_000, 5_400_000, "periodic"))
        assertNull(store.capture(command, 180_500, 5_400_000, "transient-backwards"))
    }

    @Test fun failedCommitRollsBackAndDoesNotConsumeSequenceOrDeleteEvidence() {
        val owned = assign()
        val saved = store.capture(owned, 2_700_000, 5_400_000, "periodic", true)!!
        store.writableDatabase.execSQL("CREATE TRIGGER fail_position BEFORE INSERT ON positions BEGIN SELECT RAISE(ABORT, 'injected write failure'); END")
        try {
            store.capture(owned, 2_701_000, 5_400_000, "periodic")
            fail("A failed COMMIT must not return a successful receipt")
        } catch (_: android.database.sqlite.SQLiteException) { }
        assertEquals(saved.toString(), store.read(scope)!!.toString())
        store.writableDatabase.execSQL("DROP TRIGGER fail_position")
        val next = store.capture(owned, 2_702_000, 5_400_000, "periodic")!!
        assertEquals(saved.getLong("sequence") + 1, next.getLong("sequence"))
    }

    @Test fun explicitUnreadIsIdempotentAndOldAcknowledgementCannotSyncNewCommand() {
        val owned = assign()
        val old = store.capture(owned, 2_700_000, 5_400_000, "periodic", true)!!
        val unread = store.set(scope, 0, 5_400_000, false, "unread", "unread-command")
        assertEquals(unread.getLong("sequence"), store.set(scope, 0, 5_400_000, false, "unread", "unread-command").getLong("sequence"))
        assertNull(store.capture(owned, 2_701_000, 5_400_000, "late-progress"))
        val staleAcknowledgement = store.acknowledge(scope, old.getLong("sequence"), "synced")!!
        assertEquals(0L, staleAcknowledgement.getLong("positionMs"))
        assertEquals(old.getLong("sequence"), staleAcknowledgement.getLong("syncedThroughSequence"))
        assertTrue(staleAcknowledgement.getLong("syncedThroughSequence") < unread.getLong("sequence"))
        val current = store.acknowledge(scope, unread.getLong("sequence"), "synced")!!
        assertEquals(unread.getLong("sequence"), current.getLong("syncedThroughSequence"))
        assertNotNull(store.read(scope))
    }

    @Test fun ownersEpisodesAndWholeBookOffsetsStaySeparate() {
        val episode = ListeningPositionStore.Scope("listener-a", "podcast", "episode-1")
        val otherOwner = ListeningPositionStore.Scope("listener-b", "podcast", "episode-1")
        val otherEpisode = ListeningPositionStore.Scope("listener-a", "podcast", "episode-2")
        val owned = store.assign(episode, "episode-load", "episode-file", 0, 3_600_000, false, 180_000)
        store.capture(owned, 180_000, 3_600_000, "load-confirmed", true)
        assertNull(store.read(otherOwner))
        assertNull(store.read(otherEpisode))
        val first = assign()
        store.capture(first, 1_800_000, 1_800_000, "track-end", true)
        val second = store.assign(scope, "second-file", "file-b", 1_800_000, 5_400_000, false, 1_800_000)
        val progress = store.capture(second, 900_000, 3_600_000, "periodic", true)!!
        assertEquals(2_700_000L, progress.getLong("positionMs"))
        assertEquals(900_000L, progress.getLong("trackPositionMs"))
        assertEquals(1_800_000L, progress.getLong("trackStartOffsetMs"))
    }

    @Test fun inactiveCommandDoesNotFenceAnotherPlayableAndPreviewAssignmentDoesNotProject() {
        val owned = assign()
        val saved = store.capture(owned, 2_700_000, 5_400_000, "periodic", true)!!
        val other = ListeningPositionStore.Scope("listener-b", "book-b", null)
        val inactive = store.set(other, 0, 5_400_000, false, "unread", "inactive-unread")
        assertEquals(0L, inactive.getLong("playbackGeneration"))
        assertNotNull(store.capture(owned, 2_701_000, 5_400_000, "still-active"))
        val beforePreview = store.read(scope)!!
        store.assign(scope, "preview-load", "file-b", 1_800_000, 5_400_000, false, 4_000_000)
        assertEquals(beforePreview.toString(), store.read(scope)!!.toString())
        val restored = store.assign(scope, "normal-restored", "file-a", 0, 5_400_000, false, 2_701_000)
        assertNotNull(store.capture(restored, 2_701_000, 5_400_000, "restored-and-confirmed", true))
        assertNull(store.capture(owned, 2_800_000, 5_400_000, "stale-preview-predecessor"))
        assertTrue(store.read(scope)!!.getLong("sequence") > saved.getLong("sequence"))
    }

    @Test fun invalidCaptureCannotReplaceGoodRecordAndCompletedPositionRemainsFinished() {
        val owned = assign()
        val previous = store.capture(owned, 180_000, 5_400_000, "load-confirmed", true)!!
        try { store.capture(owned, -1, 5_400_000, "corrupt-sample"); fail("Negative sample accepted") }
        catch (_: IllegalArgumentException) { }
        assertEquals(previous.toString(), store.read(scope)!!.toString())
        store.capture(owned, 5_400_000, 5_400_000, "natural-completion", isFinished = true)
        store.capture(owned, 5_400_000, 5_400_000, "late-stop")
        assertTrue(store.read(scope)!!.getBoolean("isFinished"))
    }

    @Test fun relocationRetryUsesOriginalTargetAndDoesNotApplySameAutoRewindTwice() {
        val old = assign()
        store.capture(old, 2_700_000, 5_400_000, "periodic", true)
        val pending = store.assign(scope, "rewind-first", "file-a", 0, 5_400_000, true, 2_680_000, "stable-auto-rewind")
        val retried = store.assign(scope, "rewind-retry", "file-a", 0, 5_400_000, true, 2_660_000, "stable-auto-rewind")
        assertEquals(pending.revision, retried.revision)
        assertEquals(2_680_000L, store.relocationCommand(scope, "stable-auto-rewind")!!.targetMs)
        store.capture(retried, 2_680_000, 5_400_000, "rewind-confirmed", true)
        store.capture(retried, 2_685_000, 5_400_000, "playing-after-rewind")
        val secondRetry = store.assign(scope, "rewind-restart", "file-a", 0, 5_400_000, true, 2_665_000, "stable-auto-rewind")
        assertEquals(retried.revision, secondRetry.revision)
        assertNull(secondRetry.initialCommandId)
        assertNull(store.capture(secondRetry, 2_665_000, 5_400_000, "second-rewind", true))
        assertEquals(2_685_000L, store.read(scope)!!.getLong("positionMs"))
    }
}
