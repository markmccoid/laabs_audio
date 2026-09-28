package dev.rnap.reactnativeaudiopro

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** Access only on the listening-position writer. A receipt is returned only after COMMIT. */
internal class ListeningPositionStore(context: Context, databaseName: String = "audio-pro-listening-position.sqlite") :
    SQLiteOpenHelper(context.applicationContext, databaseName, null, 1,
        DatabaseErrorHandler { throw SQLiteDatabaseCorruptException("Listening-position database requires recovery; preserved original files") }) {
    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            setOpenParams(SQLiteDatabase.OpenParams.Builder()
                .addOpenFlags(SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING)
                .setJournalMode("WAL").setSynchronousMode("FULL").build())
        }
    }
    override fun onConfigure(db: SQLiteDatabase) {
        db.enableWriteAheadLogging()
        db.execSQL("PRAGMA synchronous=FULL")
        db.rawQuery("PRAGMA journal_mode", null).use {
            check(it.moveToFirst() && it.getString(0).equals("wal", true)) { "Listening position requires WAL" }
        }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE positions (scope TEXT PRIMARY KEY, record TEXT NOT NULL)")
        db.execSQL("CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE commands (scope TEXT NOT NULL, command_id TEXT NOT NULL, revision INTEGER NOT NULL, generation INTEGER NOT NULL, target INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(scope, command_id))")
        listOf("generation", "revision", "sequence").forEach {
            db.execSQL("INSERT INTO counters VALUES (?, 0)", arrayOf(it))
        }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        error("Unsupported listening-position schema migration")
    }

    data class Scope(val ownerId: String, val libraryItemId: String, val episodeId: String?) {
        init { require(ownerId.isNotBlank() && libraryItemId.isNotBlank()) { "Missing listening position owner/playable" } }
        val key: String get() = JSONArray().put(ownerId).put(libraryItemId).put(episodeId ?: JSONObject.NULL).toString()
    }

    data class Assignment(val scope: Scope, val generation: Long, val revision: Long,
        val loadId: String, val trackId: String, val offsetMs: Long, val durationMs: Long,
        val initialCommandId: String?)

    data class RelocationCommand(val revision: Long, val targetMs: Long, val confirmed: Boolean)
    fun relocationCommand(scope: Scope, commandId: String): RelocationCommand? =
        command(writableDatabase, scope, commandId)
    private fun command(db: SQLiteDatabase, scope: Scope, commandId: String): RelocationCommand? =
        db.rawQuery("SELECT revision,target,status FROM commands WHERE scope=? AND command_id=?", arrayOf(scope.key, commandId)).use {
            if (it.moveToFirst()) RelocationCommand(it.getLong(0), it.getLong(1), it.getString(2) == "confirmed") else null
        }

    private fun counter(db: SQLiteDatabase, name: String): Long =
        db.rawQuery("SELECT value FROM counters WHERE name=?", arrayOf(name)).use { check(it.moveToFirst()); it.getLong(0) }

    private fun next(db: SQLiteDatabase, name: String): Long {
        val value = counter(db, name) + 1
        db.execSQL("UPDATE counters SET value=? WHERE name=?", arrayOf(value, name))
        return value
    }

    private fun <T> transaction(block: (SQLiteDatabase) -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try {
            // Verify the actual writer connection. Android 26/27 lack OpenParams sync configuration.
            db.rawQuery("PRAGMA synchronous", null).use {
                check(it.moveToFirst() && it.getInt(0) == 2) { "Listening position requires FULL synchronization" }
            }
            val result = block(db)
            db.setTransactionSuccessful()
            // endTransaction performs COMMIT before a result leaves this method.
            db.endTransaction()
            return result
        } catch (error: Throwable) {
            if (db.inTransaction()) db.endTransaction()
            throw error
        }
    }

    fun read(scope: Scope): JSONObject? = read(writableDatabase, scope)
    private fun read(db: SQLiteDatabase, scope: Scope): JSONObject? =
        db.rawQuery("SELECT record FROM positions WHERE scope=?", arrayOf(scope.key)).use {
            if (it.moveToFirst()) JSONObject(it.getString(0)) else null
        }

    fun assign(scope: Scope, loadId: String, trackId: String, offsetMs: Long, durationMs: Long,
        relocate: Boolean, targetMs: Long, positionCommandId: String? = null): Assignment = transaction { db ->
        require(offsetMs >= 0 && durationMs >= 0 && targetMs >= 0) { "Invalid playback assignment" }
        val previous = read(db, scope)
        val generation = next(db, "generation")
        val requestedCommandId = if (relocate) positionCommandId ?: "load:$loadId" else null
        val existing = requestedCommandId?.let { command(db, scope, it) }
        val superseded = existing != null && (existing.confirmed || (previous?.optLong("positionRevision") ?: 0) > existing.revision)
        val revision = when {
            superseded && previous != null -> previous.getLong("positionRevision")
            existing != null -> existing.revision
            relocate || previous == null -> next(db, "revision")
            else -> previous.getLong("positionRevision")
        }
        val commandId = requestedCommandId?.takeUnless { superseded }
        if (commandId != null) journal(db, scope, commandId, revision, generation, existing?.targetMs ?: targetMs)
        Assignment(scope, generation, revision, loadId, trackId, offsetMs, durationMs, commandId)
    }

    /** Request journaling fences old samples; the confirmed record remains unchanged. */
    fun requestSeek(assignment: Assignment, targetMs: Long, commandId: String): Assignment = transaction { db ->
        check(counter(db, "generation") == assignment.generation) { "Playback ownership changed" }
        val previous = read(db, assignment.scope)
        check(previous == null || previous.getLong("positionRevision") == assignment.revision) { "Position revision changed" }
        val revision = next(db, "revision")
        journal(db, assignment.scope, commandId, revision, assignment.generation, targetMs)
        assignment.copy(revision = revision, initialCommandId = commandId)
    }

    private fun journal(db: SQLiteDatabase, scope: Scope, commandId: String, revision: Long, generation: Long, target: Long) {
        db.execSQL("INSERT OR REPLACE INTO commands VALUES (?, ?, ?, ?, ?, 'pending')", arrayOf(scope.key, commandId, revision, generation, target))
    }

    fun capture(assignment: Assignment, trackPositionMs: Long, durationMs: Long,
        reason: String, confirmCommand: Boolean = false, isFinished: Boolean = false): JSONObject? = transaction { db ->
        if (counter(db, "generation") != assignment.generation) return@transaction null
        val newerPending = db.rawQuery("SELECT 1 FROM commands WHERE scope=? AND generation=? AND revision>? AND status='pending' LIMIT 1",
            arrayOf(assignment.scope.key, assignment.generation.toString(), assignment.revision.toString())).use { it.moveToFirst() }
        if (newerPending) return@transaction null
        require(trackPositionMs >= 0) { "Invalid native position" }
        val previous = read(db, assignment.scope)
        val wholePosition = Math.addExact(assignment.offsetMs, trackPositionMs)
        val previousRevision = previous?.optLong("positionRevision") ?: 0
        if (assignment.revision < previousRevision) return@transaction null
        if (assignment.revision > previousRevision && previous != null && !confirmCommand) return@transaction null
        if (assignment.revision == previousRevision && previous != null && wholePosition < previous.getLong("positionMs")) return@transaction null
        // Pending seeks cannot become authoritative from a periodic/teardown capture.
        if (assignment.initialCommandId != null) {
            val pending = db.rawQuery("SELECT status FROM commands WHERE scope=? AND command_id=?", arrayOf(assignment.scope.key, assignment.initialCommandId)).use {
                it.moveToFirst() && it.getString(0) == "pending"
            }
            if (pending && !confirmCommand) return@transaction null
            if (pending) db.execSQL("UPDATE commands SET status='confirmed' WHERE scope=? AND command_id=?", arrayOf(assignment.scope.key, assignment.initialCommandId))
        }
        val record = record(db, assignment.scope, assignment.generation, assignment.revision,
            wholePosition, trackPositionMs, assignment.offsetMs, assignment.trackId,
            assignment.durationMs.takeIf { it > 0 } ?: (assignment.offsetMs + durationMs),
            isFinished || (previous?.optBoolean("isFinished") == true && previousRevision == assignment.revision), reason, previous)
        write(db, assignment.scope, record)
        record
    }

    fun set(scope: Scope, positionMs: Long, durationMs: Long, isFinished: Boolean, reason: String, commandId: String?, activeGeneration: Long? = null): JSONObject = transaction { db ->
        require(positionMs >= 0 && durationMs >= 0) { "Invalid listening position" }
        val previous = read(db, scope)
        if (commandId != null) {
            val confirmed = db.rawQuery("SELECT status FROM commands WHERE scope=? AND command_id=?", arrayOf(scope.key, commandId)).use {
                it.moveToFirst() && it.getString(0) == "confirmed"
            }
            if (confirmed && previous != null) return@transaction previous
        }
        val revision = next(db, "revision")
        // An inactive unread/finished command does not claim another playable's active lease.
        val generation = activeGeneration ?: previous?.optLong("playbackGeneration") ?: 0L
        if (commandId != null) {
            journal(db, scope, commandId, revision, generation, positionMs)
            db.execSQL("UPDATE commands SET status='confirmed' WHERE scope=? AND command_id=?", arrayOf(scope.key, commandId))
        }
        val record = record(db, scope, generation, revision, positionMs, positionMs, 0, "",
            durationMs, isFinished, reason, previous)
        write(db, scope, record)
        record
    }

    fun acknowledge(scope: Scope, sequence: Long, kind: String): JSONObject? = transaction { db ->
        require(kind == "projected" || kind == "synced") { "Unknown acknowledgement kind" }
        val record = read(db, scope) ?: return@transaction null
        // A through watermark acknowledges only the submitted sequence, never newer progress.
        if (sequence < 0 || sequence > record.getLong("sequence")) return@transaction record
        val key = if (kind == "projected") "projectedThroughSequence" else "syncedThroughSequence"
        if (sequence <= record.getLong(key)) return@transaction record
        record.put(key, sequence)
        write(db, scope, record)
        record
    }

    private fun record(db: SQLiteDatabase, scope: Scope, generation: Long, revision: Long,
        positionMs: Long, trackPositionMs: Long, offsetMs: Long, trackId: String, durationMs: Long,
        finished: Boolean, reason: String, previous: JSONObject?): JSONObject {
        val now = System.currentTimeMillis()
        return JSONObject().put("schemaVersion", 1).put("ownerId", scope.ownerId)
            .put("libraryItemId", scope.libraryItemId).put("episodeId", scope.episodeId ?: JSONObject.NULL)
            .put("playbackGeneration", generation).put("positionRevision", revision).put("sequence", next(db, "sequence"))
            .put("positionMs", positionMs).put("trackPositionMs", trackPositionMs).put("trackStartOffsetMs", offsetMs)
            .put("trackIdentity", trackId).put("durationMs", durationMs.coerceAtLeast(0)).put("isFinished", finished)
            .put("reason", reason).put("capturedAt", now).put("committedAt", now)
            .put("projectedThroughSequence", previous?.optLong("projectedThroughSequence") ?: 0)
            .put("syncedThroughSequence", previous?.optLong("syncedThroughSequence") ?: 0)
    }

    private fun write(db: SQLiteDatabase, scope: Scope, record: JSONObject) {
        val values = ContentValues().apply { put("scope", scope.key); put("record", record.toString()) }
        check(db.insertWithOnConflict("positions", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "Listening position write failed" }
    }
}
