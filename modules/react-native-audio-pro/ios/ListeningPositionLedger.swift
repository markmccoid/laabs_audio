import Foundation
import SQLite3

/// All operations run on AudioPro's single writer queue. A receipt is returned only after COMMIT.
struct ListeningScope: Equatable {
    let ownerId: String
    let libraryItemId: String
    let episodeId: String?
    init?(_ payload: [String: Any]) {
        guard let owner = payload["ownerId"] as? String, !owner.isEmpty,
              let item = payload["libraryItemId"] as? String, !item.isEmpty else { return nil }
        ownerId = owner; libraryItemId = item; episodeId = payload["episodeId"] as? String
    }
    var key: String { String(data: try! JSONSerialization.data(withJSONObject: [ownerId, libraryItemId, episodeId ?? "" ]), encoding: .utf8)! }
    var fields: [String: Any] { ["ownerId": ownerId, "libraryItemId": libraryItemId, "episodeId": episodeId as Any? ?? NSNull()] }
}
struct ListeningLease {
    let scope: ListeningScope
    let generation: Int64
    var revision: Int64
}
enum ListeningLedgerError: Error, CustomStringConvertible {
    case storage(String), stale, invalid
    var description: String {
        switch self { case .storage(let message): return message; case .stale: return "Superseded playback generation or position revision"; case .invalid: return "Invalid listening position" }
    }
}
final class ListeningPositionLedger {
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private var active: ListeningLease?
    private(set) var diagnostics: [[String: Any]] = []
    private(set) var failedWrites = 0
    init(path: String) throws {
        if sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) != SQLITE_OK {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite open failed"
            if let db { sqlite3_close(db) }; db = nil
            throw ListeningLedgerError.storage(message)
        }
        do {
            sqlite3_busy_timeout(db, 1500)
            try sql("PRAGMA journal_mode=WAL"); try sql("PRAGMA synchronous=FULL")
            guard try scalar("PRAGMA synchronous") == 2, try stringScalar("PRAGMA journal_mode") == "wal" else { throw ListeningLedgerError.storage("Durable SQLite configuration unavailable") }
            try sql("CREATE TABLE IF NOT EXISTS positions (scope TEXT PRIMARY KEY, data TEXT NOT NULL)")
            try sql("CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)")
            try sql("CREATE TABLE IF NOT EXISTS commands (scope TEXT NOT NULL, command TEXT NOT NULL, revision INTEGER NOT NULL, target REAL NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope,command))")
        } catch { if let db { sqlite3_close(db) }; db = nil; throw error }
    }
    deinit { if let db { sqlite3_close(db) } }
    private func sql(_ query: String) throws {
        guard sqlite3_exec(db, query, nil, nil, nil) == SQLITE_OK else { throw ListeningLedgerError.storage(String(cString: sqlite3_errmsg(db))) }
    }
    private func statement(_ query: String, _ values: [Any] = []) throws -> OpaquePointer {
        var handle: OpaquePointer?
        guard sqlite3_prepare_v2(db, query, -1, &handle, nil) == SQLITE_OK, let handle else { throw ListeningLedgerError.storage(String(cString: sqlite3_errmsg(db))) }
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            if let text = value as? String { sqlite3_bind_text(handle, index, text, -1, transient) }
            else if let number = value as? Int64 { sqlite3_bind_int64(handle, index, number) }
            else if let number = value as? Double { sqlite3_bind_double(handle, index, number) }
            else { sqlite3_finalize(handle); throw ListeningLedgerError.invalid }
        }
        return handle
    }
    private func execute(_ query: String, _ values: [Any]) throws {
        let handle = try statement(query, values); defer { sqlite3_finalize(handle) }
        guard sqlite3_step(handle) == SQLITE_DONE else { throw ListeningLedgerError.storage(String(cString: sqlite3_errmsg(db))) }
    }
    private func scalar(_ query: String, _ values: [Any] = []) throws -> Int64 {
        let handle = try statement(query, values); defer { sqlite3_finalize(handle) }
        let result = sqlite3_step(handle)
        if result == SQLITE_DONE { return 0 }
        guard result == SQLITE_ROW else { throw ListeningLedgerError.storage(String(cString: sqlite3_errmsg(db))) }
        return sqlite3_column_int64(handle, 0)
    }
    private func stringScalar(_ query: String, _ values: [Any] = []) throws -> String? {
        let handle = try statement(query, values); defer { sqlite3_finalize(handle) }
        let result = sqlite3_step(handle)
        if result == SQLITE_DONE { return nil }
        guard result == SQLITE_ROW, let bytes = sqlite3_column_text(handle, 0) else { throw ListeningLedgerError.storage(String(cString: sqlite3_errmsg(db))) }
        return String(cString: bytes)
    }
    private func transaction<T>(_ operation: () throws -> T) throws -> T {
        do { try sql("BEGIN IMMEDIATE"); let result = try operation(); try sql("COMMIT"); return result }
        catch { try? sql("ROLLBACK"); failedWrites += 1; trace("write-failed", ["error": String(describing: error)]); throw error }
    }
    private func allocate(_ name: String) throws -> Int64 {
        try execute("INSERT INTO counters(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1", [name])
        return try scalar("SELECT value FROM counters WHERE name=?", [name])
    }
    func trace(_ reason: String, _ fields: [String: Any] = [:]) {
        var entry = fields; entry["reason"] = reason; entry["at"] = Date().timeIntervalSince1970 * 1000
        diagnostics.append(entry); if diagnostics.count > 128 { diagnostics.removeFirst(diagnostics.count - 128) }
    }
    func read(_ scope: ListeningScope) throws -> [String: Any]? {
        guard let data = try stringScalar("SELECT data FROM positions WHERE scope=?", [scope.key]) else { return nil }
        guard let record = try JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any],
              let position = record["positionMs"] as? NSNumber, position.doubleValue.isFinite, position.doubleValue >= 0 else { throw ListeningLedgerError.storage("Corrupted listening position record") }
        return record
    }
    func activate(_ scope: ListeningScope, makeActive: Bool = true) throws -> ListeningLease {
        let lease = try transaction { () throws -> ListeningLease in
            let old = try read(scope)
            let revision = (old?["positionRevision"] as? NSNumber)?.int64Value ?? 0
            let generation = try allocate("generation")
            if makeActive {
                try execute("INSERT INTO counters(name,value) VALUES('active_generation',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", [generation])
                try execute("INSERT INTO counters(name,value) VALUES('active_revision',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", [revision])
            }
            return ListeningLease(scope: scope, generation: generation, revision: revision)
        }
        active = lease; trace("ownership", ["playbackGeneration": lease.generation]); return lease
    }
    func end(_ lease: ListeningLease) { if active?.generation == lease.generation { active = nil } }
    func beginRelocation(_ lease: ListeningLease, target: Double, commandId: String, detached: Bool = false) throws -> ListeningLease {
        guard target.isFinite, target >= 0, active?.generation == lease.generation else { throw ListeningLedgerError.stale }
        let revision = try transaction { () throws -> Int64 in
            if !detached {
                guard try scalar("SELECT value FROM counters WHERE name='active_generation'") == lease.generation else { throw ListeningLedgerError.stale }
            }
            let existing = try scalar("SELECT revision FROM commands WHERE scope=? AND command=?", [lease.scope.key, commandId])
            if existing > 0 {
                guard active?.revision == existing else { throw ListeningLedgerError.stale }
                return existing
            }
            let revision = try allocate("revision")
            try execute("INSERT INTO commands(scope,command,revision,target) VALUES(?,?,?,?)", [lease.scope.key, commandId, revision, target])
            if !detached { try execute("UPDATE counters SET value=? WHERE name='active_revision'", [revision]) }
            return revision
        }
        var next = lease; next.revision = revision; active = next
        trace("relocation-request", ["positionRevision": revision, "targetMs": target]); return next
    }
    func commit(_ lease: ListeningLease, positionMs: Double, trackPositionMs: Double, offsetMs: Double, trackId: String, durationMs: Double, finished: Bool = false, reason: String, commandId: String? = nil,
                capturedAt: Double? = nil, capturedMonotonic: TimeInterval? = nil, detached: Bool = false) throws -> [String: Any] {
        guard positionMs.isFinite, trackPositionMs.isFinite, offsetMs.isFinite, durationMs.isFinite,
              positionMs >= 0, trackPositionMs >= 0, offsetMs >= 0, durationMs >= 0 else { throw ListeningLedgerError.invalid }
        guard active?.generation == lease.generation, active?.revision == lease.revision else { throw ListeningLedgerError.stale }
        let start = ProcessInfo.processInfo.systemUptime
        let record = try transaction { () throws -> [String: Any] in
            if !detached {
                guard try scalar("SELECT value FROM counters WHERE name='active_generation'") == lease.generation,
                      try scalar("SELECT value FROM counters WHERE name='active_revision'") == lease.revision else { throw ListeningLedgerError.stale }
            }
            let old = try read(lease.scope)
            let oldRevision = (old?["positionRevision"] as? NSNumber)?.int64Value ?? 0
            let oldGeneration = (old?["playbackGeneration"] as? NSNumber)?.int64Value ?? 0
            guard oldRevision <= lease.revision, oldGeneration <= lease.generation else { throw ListeningLedgerError.stale }
            if let old, oldRevision == lease.revision, let oldPosition = old["positionMs"] as? NSNumber, positionMs < oldPosition.doubleValue { return old }
            // Do not confirm a pending command from a periodic/transient sample.
            let pending = try scalar("SELECT count(*) FROM commands WHERE scope=? AND revision=? AND confirmed=0", [lease.scope.key, lease.revision])
            if pending > 0 && commandId == nil { throw ListeningLedgerError.stale }
            let now = Date().timeIntervalSince1970 * 1000
            var record = lease.scope.fields
            record.merge(["schemaVersion": 1, "playbackGeneration": lease.generation, "positionRevision": lease.revision,
                          "sequence": try allocate("sequence"), "positionMs": positionMs, "trackPositionMs": trackPositionMs,
                          "trackStartOffsetMs": offsetMs, "trackIdentity": trackId, "durationMs": durationMs,
                          "isFinished": finished, "reason": reason, "capturedAt": capturedAt ?? now, "committedAt": now,
                          "projectedThroughSequence": old?["projectedThroughSequence"] ?? 0,
                          "syncedThroughSequence": old?["syncedThroughSequence"] ?? 0]) { _, new in new }
            let json = String(data: try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]), encoding: .utf8)!
            try execute("INSERT INTO positions(scope,data) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET data=excluded.data", [lease.scope.key, json])
            if let commandId { try execute("UPDATE commands SET confirmed=1 WHERE scope=? AND command=? AND revision=?", [lease.scope.key, commandId, lease.revision]) }
            return record
        }
        trace("committed", ["sequence": record["sequence"] ?? 0, "positionMs": record["positionMs"] ?? 0,
                            "playbackGeneration": lease.generation, "positionRevision": lease.revision,
                            "ownerId": lease.scope.ownerId, "libraryItemId": lease.scope.libraryItemId,
                            "captureReason": reason, "trackPositionMs": trackPositionMs,
                            "captureToCommitAgeMs": (ProcessInfo.processInfo.systemUptime - (capturedMonotonic ?? start)) * 1000,
                            "commitLatencyMs": (ProcessInfo.processInfo.systemUptime - start) * 1000])
        return record
    }
    func confirmedCommandRecord(_ scope: ListeningScope, commandId: String) throws -> [String: Any]? {
        guard try scalar("SELECT count(*) FROM commands WHERE scope=? AND command=? AND confirmed=1", [scope.key, commandId]) > 0 else { return nil }
        return try read(scope)
    }
    /// Saved-state commands can update an inactive playable without stealing the live owner's lease.
    func setExplicit(_ scope: ListeningScope, positionMs: Double, durationMs: Double, finished: Bool,
                     reason: String, commandId: String) throws -> [String: Any] {
        if try scalar("SELECT count(*) FROM commands WHERE scope=? AND command=? AND confirmed=1", [scope.key, commandId]) > 0,
           let record = try read(scope) { return record }
        let previous = active
        let selected = previous?.scope == scope ? previous! : try activate(scope, makeActive: false)
        defer { if previous?.scope != scope { active = previous } }
        let detached = previous?.scope != scope
        let next = try beginRelocation(selected, target: positionMs, commandId: commandId, detached: detached)
        return try commit(next, positionMs: positionMs, trackPositionMs: positionMs, offsetMs: 0, trackId: "",
                          durationMs: durationMs, finished: finished, reason: reason, commandId: commandId, detached: detached)
    }
    func acknowledge(_ scope: ListeningScope, sequence: Int64, kind: String) throws -> [String: Any]? {
        guard sequence >= 0, kind == "projected" || kind == "synced" else { throw ListeningLedgerError.invalid }
        return try transaction {
            guard var record = try read(scope), let latest = record["sequence"] as? NSNumber else { return nil }
            guard sequence <= latest.int64Value else { throw ListeningLedgerError.invalid }
            let field = kind == "projected" ? "projectedThroughSequence" : "syncedThroughSequence"
            record[field] = max((record[field] as? NSNumber)?.int64Value ?? 0, sequence)
            let json = String(data: try JSONSerialization.data(withJSONObject: record), encoding: .utf8)!
            try execute("UPDATE positions SET data=? WHERE scope=?", [json, scope.key]); return record
        }
    }
}
