package dev.rnap.reactnativeaudiopro

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.Player
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The service captures the actual player, even with no bridge or JS progress listeners. */
internal object NativeListeningPosition {
    private val main = Handler(Looper.getMainLooper())
    private val writer = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "AudioProPositionWriter") }
    private var store: ListeningPositionStore? = null
    private var player: Player? = null
    private var assignment: ListeningPositionStore.Assignment? = null
    private var expectedMediaId: String? = null
    private var currentLoadId: String? = null
    private var currentTrackId: String? = null
    private var captureEnabled = false
    private var initialSeekPending = false
    private var initialTargetMs = 0L
    private var positionSequence = 0L
    private var revisionPending = false
    private var savingFailed = false
    private var timerRunning = false
    private val periodicOutstanding = AtomicBoolean(false)
    private val diagnostics = ArrayDeque<JSONObject>()
    private var failedWriteCount = 0L
    private var lastCommittedMonotonicMs = 0L
    private var lastCapturedMonotonicMs = 0L
    private var lastCommitLatencyMs = 0L
    private var lastMovementAt = 0L
    private var lastMovementPosition = 0L
    private var stalled = false
    private var pendingRemoteSeekPosition: Long? = null
    private var pendingSeek: Pair<Long, (Long) -> Unit>? = null
    private var capturePolicyRevision = 0L

    fun initialize(context: Context) {
        synchronized(this) { if (store == null) store = ListeningPositionStore(context.applicationContext) }
    }

    private fun db(): ListeningPositionStore = store ?: error("Listening-position storage unavailable")
    private fun scope(map: ReadableMap) = ListeningPositionStore.Scope(
        map.getString("ownerId") ?: "", map.getString("libraryItemId") ?: "",
        if (map.hasKey("episodeId") && !map.isNull("episodeId")) map.getString("episodeId") else null)
    private fun number(map: ReadableMap, name: String, default: Long = 0L): Long {
        if (!map.hasKey(name) || map.isNull(name)) return default
        val value = map.getDouble(name)
        require(value.isFinite() && value >= 0 && value <= Long.MAX_VALUE.toDouble()) { "Invalid $name" }
        return value.toLong()
    }

    private suspend fun <T> writeAwait(block: () -> T): T = suspendCancellableCoroutine { continuation ->
        writer.execute {
            try { val result = block(); if (continuation.isActive) continuation.resume(result) }
            catch (error: Throwable) { if (continuation.isActive) continuation.resumeWithException(error) }
        }
    }

    /** Flush outgoing ownership before assigning a different generation. Never project a load request. */
    suspend fun prepareLoad(trackId: String, mediaId: String, options: ReadableMap, requestedTrackPositionMs: Long): Long {
        capturePolicyRevision++
        val outgoing = sample("source-replacement")
        if (outgoing != null) writeAwait { commit(outgoing) }
        assignment = null
        captureEnabled = false
        positionSequence = 0
        savingFailed = false
        currentLoadId = if (options.hasKey("loadId")) options.getString("loadId") ?: UUID.randomUUID().toString() else UUID.randomUUID().toString()
        currentTrackId = trackId
        expectedMediaId = mediaId
        initialTargetMs = requestedTrackPositionMs.coerceAtLeast(0)
        initialSeekPending = true
        revisionPending = false
        pendingRemoteSeekPosition = null
        pendingSeek = null
        val context = if (options.hasKey("listeningContext")) options.getMap("listeningContext") else null
        if (context == null) {
            return requestedTrackPositionMs
        }
        val ownedScope = scope(context)
        val offset = number(context, "trackStartOffsetMs")
        val duration = number(context, "durationMs")
        val loadId = currentLoadId!!
        val scopedCapture = !(context.hasKey("captureEnabled") && !context.getBoolean("captureEnabled")) &&
            !(options.hasKey("positionIntent") && options.getString("positionIntent") == "preview")
        val relocate = scopedCapture && options.hasKey("positionIntent") && options.getString("positionIntent") == "relocate"
        val positionCommandId = if (options.hasKey("positionCommandId")) options.getString("positionCommandId") else null
        val result = writeAwait {
            val previous = db().read(ownedScope)
            val command = if (relocate && positionCommandId != null) db().relocationCommand(ownedScope, positionCommandId) else null
            var target = requestedTrackPositionMs.coerceAtLeast(0)
            if (command != null) {
                val alreadyApplied = command.confirmed || (previous?.optLong("positionRevision") ?: 0) > command.revision
                if (alreadyApplied && previous != null) {
                    require(previous.getString("trackIdentity").isEmpty() || previous.getString("trackIdentity") == trackId) {
                        "Committed relocation requires a different source"
                    }
                }
                val whole = if (alreadyApplied && previous != null) previous.getLong("positionMs") else command.targetMs
                require(whole >= offset) { "Relocation retry selected the wrong source" }
                target = whole - offset
            }
            if (scopedCapture && !relocate && previous != null) {
                val whole = previous.getLong("positionMs")
                // Resolve only within the selected track. The app resolves cross-file selection first.
                if (previous.getString("trackIdentity") == trackId && whole >= offset) target = whole - offset
                if (whole > offset + target) error("Selected source is behind the committed listening position")
            }
            Pair(db().assign(ownedScope, loadId, trackId, offset, duration, relocate, Math.addExact(offset, target), positionCommandId), Pair(target, previous))
        }
        assignment = result.first
        expectedMediaId = mediaId
        positionSequence = result.second.second?.optLong("sequence") ?: 0L
        initialTargetMs = result.second.first
        initialSeekPending = true
        captureEnabled = scopedCapture
        revisionPending = false
        lastMovementAt = SystemClock.elapsedRealtime()
        lastMovementPosition = initialTargetMs
        stalled = false
        note("assigned", null)
        return initialTargetMs
    }

    fun attach(context: Context, actualPlayer: Player) {
        initialize(context)
        player = actualPlayer
        if (!timerRunning) {
            timerRunning = true
            main.postDelayed(tick, 1000)
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!timerRunning) return
            val actual = player
            if (actual != null && actual.currentMediaItem?.mediaId == expectedMediaId && !savingFailed) {
                val now = SystemClock.elapsedRealtime()
                val wantsPlayback = actual.playWhenReady && actual.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE
                if (!wantsPlayback || kotlin.math.abs(actual.currentPosition - lastMovementPosition) >= 20) {
                    lastMovementAt = now
                    lastMovementPosition = actual.currentPosition
                    stalled = false
                } else if (now - lastMovementAt >= 5000) {
                    if (!stalled) {
                        stalled = true
                        checkpoint("stalled")
                        note("stalled", null)
                    }
                    // A native heartbeat lets recovery enforce a deadline after JS resumes.
                    AudioProController.onNativeStalled()
                }
            }
            if (actual != null && actual.playbackState != Player.STATE_ENDED && (actual.isPlaying || actual.playWhenReady) && !periodicOutstanding.get()) {
                checkpoint("periodic", periodic = true)
            }
            main.postDelayed(this, 1000)
        }
    }

    fun detach(actualPlayer: Player, reason: String) {
        if (player !== actualPlayer) return
        checkpoint(reason)
        // Immutable outgoing sample stays queued; no capture occurs after release.
        player = null
        captureEnabled = false
        capturePolicyRevision++
        timerRunning = false
        main.removeCallbacks(tick)
    }

    private data class Sample(val assignment: ListeningPositionStore.Assignment, val positionMs: Long,
        val durationMs: Long, val reason: String, val confirm: Boolean, val finished: Boolean,
        val capturedMonotonicMs: Long)

    private fun sample(reason: String, confirm: Boolean = false): Sample? {
        val owned = assignment ?: return null
        val actual = player ?: return null
        if (!captureEnabled || savingFailed || revisionPending || (!confirm && initialSeekPending) ||
            actual.currentMediaItem?.mediaId != expectedMediaId) return null
        val position = actual.currentPosition
        if (position < 0) return null
        val duration = actual.duration.takeIf { it > 0 } ?: 0
        val wholeDuration = owned.durationMs.takeIf { it > 0 } ?: (owned.offsetMs + duration)
        val finished = reason == "natural-completion" && duration > 0 &&
            wholeDuration > 0 && owned.offsetMs + position >= wholeDuration - 250
        return Sample(owned, position, duration, reason, confirm, finished, SystemClock.elapsedRealtime())
    }

    private fun commit(sample: Sample): JSONObject? {
        val start = SystemClock.elapsedRealtime()
        val record = db().capture(sample.assignment, sample.positionMs, sample.durationMs, sample.reason, sample.confirm, sample.finished)
        val committedAt = SystemClock.elapsedRealtime()
        main.post {
            if (record != null) {
                lastCommitLatencyMs = committedAt - start
                lastCapturedMonotonicMs = sample.capturedMonotonicMs
                lastCommittedMonotonicMs = committedAt
                if (assignment?.generation == sample.assignment.generation && assignment?.revision == sample.assignment.revision) {
                    positionSequence = record.getLong("sequence")
                    if (sample.confirm) initialSeekPending = false
                }
                note("committed:${sample.reason}", record)
            }
        }
        return record
    }

    fun checkpoint(reason: String, promise: Promise? = null, periodic: Boolean = false) {
        val captured = sample(reason)
        if (captured == null) {
            if (promise != null) readCurrent(promise)
            return
        }
        if (periodic && !periodicOutstanding.compareAndSet(false, true)) return
        writer.execute {
            try { val record = commit(captured); promise?.resolve(record?.let(::toMap)) }
            catch (error: Throwable) { fail(error, captured.assignment.generation); promise?.reject("LISTENING_POSITION_SAVE_FAILED", error) }
            finally { if (periodic) periodicOutstanding.set(false) }
        }
    }

    fun ready() {
        if (!initialSeekPending || revisionPending) return
        val actual = player ?: return
        if (actual.currentMediaItem?.mediaId != expectedMediaId || actual.playbackState != Player.STATE_READY) return
        // setMediaItem(startPositionMs) prevents an unconfirmed setup event at zero from saving over recovery.
        if (kotlin.math.abs(actual.currentPosition - initialTargetMs) > 1500) return
        if (assignment == null || !captureEnabled) {
            // Previews have transport confirmation, without a canonical listening-position write.
            initialSeekPending = false
            AudioProController.onListeningPositionReady()
            return
        }
        val captured = sample("load-confirmed", confirm = true) ?: return
        revisionPending = true
        writer.execute {
            try {
                val record = commit(captured) ?: error("Initial position was superseded before confirmation")
                main.post {
                    if (assignment?.generation == captured.assignment.generation &&
                        assignment?.revision == captured.assignment.revision && captureEnabled) {
                        revisionPending = false
                        initialSeekPending = false
                        positionSequence = record.getLong("sequence")
                        drainPendingSeekOrPublish()
                    }
                }
            } catch (error: Throwable) { fail(error, captured.assignment.generation) }
        }
    }

    /** JS/custom remote commands journal before issuing a seek. Default Media3 seeks are captured on discontinuity. */
    fun seek(targetMs: Long, perform: (Long) -> Unit) {
        val owned = assignment
        if (!captureEnabled || owned == null) { perform(targetMs); return }
        if (savingFailed) return
        if (initialSeekPending || revisionPending) {
            pendingSeek = Pair(targetMs, perform)
            return
        }
        val bounded = targetMs.coerceAtLeast(0)
        revisionPending = true
        writer.execute {
            try {
                val next = db().requestSeek(owned, owned.offsetMs + bounded, "seek:${UUID.randomUUID()}")
                main.post {
                    if (assignment?.generation == owned.generation && assignment?.revision == owned.revision && captureEnabled) {
                        assignment = next
                        revisionPending = false
                        initialSeekPending = true
                        initialTargetMs = bounded
                        perform(bounded)
                        // Seeking to the current position may not produce a discontinuity.
                        ready()
                    }
                }
            } catch (error: Throwable) { fail(error, owned.generation) }
        }
    }

    fun discontinuity(positionMs: Long, seek: Boolean) {
        if (!seek || !captureEnabled || savingFailed) return
        if (revisionPending) {
            if (!initialSeekPending) pendingRemoteSeekPosition = positionMs
            return
        }
        if (initialSeekPending) { ready(); return }
        val owned = assignment ?: return
        val actual = player ?: return
        if (actual.currentMediaItem?.mediaId != expectedMediaId) return
        val duration = actual.duration.takeIf { it > 0 } ?: 0
        revisionPending = true
        writer.execute {
            try {
                val next = db().requestSeek(owned, owned.offsetMs + positionMs, "remote-seek:${UUID.randomUUID()}")
                val record = commit(Sample(next, positionMs, duration, "remote-seek-complete", true, false, SystemClock.elapsedRealtime()))
                    ?: error("Remote seek was superseded")
                main.post {
                    if (assignment?.generation == owned.generation && assignment?.revision == owned.revision) {
                        assignment = next
                        revisionPending = false
                        positionSequence = record.getLong("sequence")
                        val pending = pendingRemoteSeekPosition
                        pendingRemoteSeekPosition = null
                        if (pending != null) discontinuity(pending, seek = true)
                        else drainPendingSeekOrPublish()
                    }
                }
            } catch (error: Throwable) { fail(error, owned.generation) }
        }
    }

    private fun drainPendingSeekOrPublish() {
        val pending = pendingSeek
        pendingSeek = null
        if (pending != null) seek(pending.first, pending.second)
        else AudioProController.onListeningPositionReady()
    }

    fun setCaptureEnabled(enabled: Boolean, promise: Promise) {
        val ownedGeneration = assignment?.generation
        val policy = ++capturePolicyRevision
        val captured = if (!enabled) sample("temporary-playback-begin") else null
        captureEnabled = false // Fence immediately before JS can begin the preview seek.
        writer.execute {
            try {
                if (captured != null) commit(captured)
                main.post {
                    if (assignment?.generation != ownedGeneration || capturePolicyRevision != policy) {
                        promise.reject("POSITION_CAPTURE_SUPERSEDED", "Playback ownership or capture policy changed")
                    } else if (enabled && assignment == null) {
                        promise.reject("POSITION_OWNER_MISSING", "No scoped listening-position owner")
                    } else if (enabled && savingFailed) {
                        promise.reject("LISTENING_POSITION_SAVE_FAILED", "Listening-position capture remains failed")
                    } else {
                        captureEnabled = enabled && assignment != null && !savingFailed
                        promise.resolve(null)
                    }
                }
            } catch (error: Throwable) { fail(error, ownedGeneration); promise.reject("LISTENING_POSITION_SAVE_FAILED", error) }
        }
    }

    fun needsLoadConfirmation(): Boolean = initialSeekPending || revisionPending

    fun get(scopeMap: ReadableMap, promise: Promise) = operation(promise) { db().read(scope(scopeMap)) }
    fun set(payload: ReadableMap, promise: Promise) {
        val scope = scope(payload)
        val affectedGeneration = assignment?.takeIf { it.scope == scope }?.generation
        if (affectedGeneration != null) {
            capturePolicyRevision++
            captureEnabled = false
            AudioProController.cancelPendingPlayback()
            player?.pause()
            pendingSeek = null
            pendingRemoteSeekPosition = null
        }
        operation(promise) {
            val record = db().set(scope, number(payload, "positionMs"), number(payload, "durationMs"),
            payload.hasKey("isFinished") && payload.getBoolean("isFinished"), payload.getString("reason") ?: "explicit-command",
            if (payload.hasKey("commandId")) payload.getString("commandId") else null, affectedGeneration)
            main.post {
                val owned = assignment
                if (owned?.scope == scope && owned.generation == affectedGeneration) {
                    assignment = owned.copy(revision = record.getLong("positionRevision"), initialCommandId = null)
                    positionSequence = record.getLong("sequence")
                    initialSeekPending = false
                    revisionPending = false
                }
            }
            record
        }
    }
    fun acknowledge(payload: ReadableMap, promise: Promise) = operation(promise) {
        db().acknowledge(scope(payload), number(payload, "sequence"), payload.getString("kind") ?: "")
    }
    private fun readCurrent(promise: Promise) {
        val owned = assignment
        if (owned == null) { promise.resolve(null); return }
        operation(promise) { db().read(owned.scope) }
    }
    private fun operation(promise: Promise, block: () -> JSONObject?) {
        writer.execute { try { promise.resolve(block()?.let(::toMap)) }
            catch (error: Throwable) { promise.reject("LISTENING_POSITION_STORAGE_ERROR", error) } }
    }

    fun metadata(payload: WritableMap, reason: String) {
        AudioProController.requestMetadata(payload)
        val owned = assignment
        payload.putString("reason", reason)
        payload.putString("loadId", currentLoadId)
        payload.putBoolean("initialSeekPending", initialSeekPending || revisionPending)
        payload.putDouble("playbackGeneration", owned?.generation?.toDouble() ?: 0.0)
        payload.putDouble("positionRevision", owned?.revision?.toDouble() ?: 0.0)
        payload.putDouble("positionSequence", positionSequence.toDouble())
        payload.putString("ownerId", owned?.scope?.ownerId)
        payload.putString("libraryItemId", owned?.scope?.libraryItemId)
        payload.putString("episodeId", owned?.scope?.episodeId)
        payload.putDouble("monotonicTimeMs", SystemClock.elapsedRealtime().toDouble())
        payload.putBoolean("shouldBePlaying", player?.playWhenReady == true &&
            player?.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE && !savingFailed)
    }

    fun state(): String {
        val actual = player ?: return AudioProModule.STATE_IDLE
        return when {
            savingFailed || actual.playerError != null -> AudioProModule.STATE_ERROR
            actual.currentMediaItem == null -> AudioProModule.STATE_IDLE
            actual.playbackState == Player.STATE_ENDED || actual.playbackState == Player.STATE_IDLE -> AudioProModule.STATE_STOPPED
            actual.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE -> AudioProModule.STATE_PAUSED
            initialSeekPending || revisionPending -> AudioProModule.STATE_LOADING
            !actual.playWhenReady -> AudioProModule.STATE_PAUSED
            stalled || actual.playbackState == Player.STATE_BUFFERING -> AudioProModule.STATE_LOADING
            actual.isPlaying -> AudioProModule.STATE_PLAYING
            else -> AudioProModule.STATE_PAUSED
        }
    }
    fun snapshot(): WritableMap = Arguments.createMap().apply {
        putString("state", state())
        putDouble("position", player?.currentPosition?.coerceAtLeast(0)?.toDouble() ?: 0.0)
        putDouble("duration", player?.duration?.coerceAtLeast(0)?.toDouble() ?: 0.0)
        putString("trackId", currentTrackId)
        putDouble("monotonicTimeMs", SystemClock.elapsedRealtime().toDouble())
        metadata(this, if (stalled) "stalled" else "native-snapshot")
    }

    private fun fail(error: Throwable, generation: Long?) {
        main.post {
            failedWriteCount++
            note("save-failed", null)
            if (generation == assignment?.generation) {
                savingFailed = true
                captureEnabled = false
                revisionPending = false
                player?.pause()
                AudioProController.onListeningPositionFailure()
            }
        }
        // Avoid authenticated source/error messages in diagnostics.
        android.util.Log.e("AudioProPosition", "Listening-position commit failed (${error.javaClass.simpleName})")
    }
    private fun note(reason: String, record: JSONObject?) {
        while (diagnostics.size >= 64) diagnostics.removeFirst()
        diagnostics.addLast(JSONObject().put("reason", reason).put("at", SystemClock.elapsedRealtime())
            .put("playbackGeneration", assignment?.generation ?: 0).put("positionRevision", assignment?.revision ?: 0)
            .put("sequence", record?.optLong("sequence") ?: positionSequence)
            .put("positionMs", record?.optLong("positionMs") ?: JSONObject.NULL))
    }
    fun diagnostics(): WritableMap = Arguments.createMap().apply {
        val now = SystemClock.elapsedRealtime()
        putString("platform", "android")
        putBoolean("durableCapture", true)
        putBoolean("captureEnabled", captureEnabled)
        putBoolean("savingFailed", savingFailed)
        putBoolean("initialSeekPending", initialSeekPending || revisionPending)
        putBoolean("periodicWriteOutstanding", periodicOutstanding.get())
        putDouble("failedWriteCount", failedWriteCount.toDouble())
        putDouble("commitLatencyMs", lastCommitLatencyMs.toDouble())
        putDouble("captureAgeMs", if (lastCapturedMonotonicMs == 0L) -1.0 else (now - lastCapturedMonotonicMs).toDouble())
        putDouble("commitAgeMs", if (lastCommittedMonotonicMs == 0L) -1.0 else (now - lastCommittedMonotonicMs).toDouble())
        putArray("events", Arguments.createArray().apply { diagnostics.forEach { pushMap(toMap(it)) } })
    }
    private fun toMap(json: JSONObject): WritableMap = Arguments.createMap().apply {
        val keys = json.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            when (val value = json.get(key)) {
                JSONObject.NULL -> putNull(key)
                is Boolean -> putBoolean(key, value)
                is Number -> putDouble(key, value.toDouble())
                else -> putString(key, value.toString())
            }
        }
    }
}
