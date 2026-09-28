import Foundation
import SQLite3

@main
struct LedgerTests {
    static let scope = ListeningScope(["ownerId": "owner-a", "libraryItemId": "book-a"])!
    static func require(_ condition: Bool, _ message: String) {
        if !condition { fatalError(message) }
    }
    static func save(_ ledger: ListeningPositionLedger, _ lease: ListeningLease, _ position: Double, command: String? = nil) throws -> [String: Any] {
        try ledger.commit(lease, positionMs: position, trackPositionMs: position, offsetMs: 0, trackId: "single-file", durationMs: 10000000, reason: "test", commandId: command)
    }
    static func main() throws {
        let args = CommandLine.arguments
        if args.count > 2 {
            let ledger = try ListeningPositionLedger(path: args[2])
            if args[1] == "write-kill" {
                let lease = try ledger.activate(scope)
                let record = try save(ledger, lease, 2700000)
                print("COMMITTED:\((record["sequence"] as! NSNumber).int64Value)"); fflush(stdout)
                while true { Thread.sleep(forTimeInterval: 1) }
            }
            if args[1] == "verify" {
                let record = try ledger.read(scope)!
                require((record["positionMs"] as! NSNumber).doubleValue == 2700000, "Commit did not survive process kill")
                require((record["sequence"] as! NSNumber).int64Value == 1, "Sequence changed on read")
                print("Separate-process commit/kill/recovery passed")
                return
            }
            if args[1] == "before-commit" {
                var raw: OpaquePointer?
                sqlite3_open(args[2], &raw)
                sqlite3_exec(raw, "BEGIN IMMEDIATE", nil, nil, nil)
                sqlite3_exec(raw, "UPDATE positions SET data=json_set(data,'$.positionMs',180000)", nil, nil, nil)
                print("UNCOMMITTED"); fflush(stdout)
                while true { Thread.sleep(forTimeInterval: 1) }
            }
            if args[1] == "before-confirmation" {
                let lease = try ledger.activate(scope)
                _ = try ledger.beginRelocation(lease, target: 180000, commandId: "pending-kill")
                print("PENDING"); fflush(stdout)
                while true { Thread.sleep(forTimeInterval: 1) }
            }
        }
        let path = NSTemporaryDirectory() + "listening-ledger-\(UUID().uuidString).sqlite"
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + suffix) } }
        let ledger = try ListeningPositionLedger(path: path)
        let first = try ledger.activate(scope)
        let initial = try save(ledger, first, 180000)
        let progressed = try save(ledger, first, 2700000)
        require((progressed["sequence"] as! NSNumber).int64Value > (initial["sequence"] as! NSNumber).int64Value, "Sequences not ordered")
        let staleTick = try save(ledger, first, 180000)
        require((staleTick["positionMs"] as! NSNumber).doubleValue == 2700000, "Resume sample overwrote progress")
        let relocated = try ledger.beginRelocation(first, target: 180000, commandId: "rewind")
        require((try ledger.read(scope)!["positionMs"] as! NSNumber).doubleValue == 2700000, "Unconfirmed seek overwrote evidence")
        do { _ = try save(ledger, first, 2800000); fatalError("Old revision accepted") } catch ListeningLedgerError.stale {}
        do { _ = try save(ledger, relocated, 180000); fatalError("Unconfirmed periodic relocation accepted") } catch ListeningLedgerError.stale {}
        let rewind = try save(ledger, relocated, 180000, command: "rewind")
        require((rewind["positionMs"] as! NSNumber).doubleValue == 180000, "Deliberate backwards seek rejected")
        let other = ListeningScope(["ownerId": "owner-b", "libraryItemId": "book-a"])!
        require(try ledger.read(other) == nil, "Owner leakage")
        let second = try ledger.activate(other)
        do { _ = try save(ledger, relocated, 3000000); fatalError("Superseded owner accepted") } catch ListeningLedgerError.stale {}
        _ = try save(ledger, second, 500000)
        _ = try ledger.acknowledge(scope, sequence: (rewind["sequence"] as! NSNumber).int64Value, kind: "projected")
        require((try ledger.read(scope)!["positionMs"] as! NSNumber).doubleValue == 180000, "Acknowledgement erased record")
        let restarted = try ListeningPositionLedger(path: path)
        require((try restarted.read(scope)!["positionMs"] as! NSNumber).doubleValue == 180000, "Paused second restart changed record")
        do { _ = try save(ledger, second, .nan); fatalError("Invalid sample accepted") } catch ListeningLedgerError.invalid {}
        // An actual SQLite lock must fail explicitly and leave last evidence unchanged.
        var competing: OpaquePointer?
        sqlite3_open(path, &competing)
        sqlite3_exec(competing, "BEGIN IMMEDIATE", nil, nil, nil)
        do { _ = try save(ledger, second, 600000); fatalError("Busy database reported success") } catch {}
        sqlite3_exec(competing, "ROLLBACK", nil, nil, nil); sqlite3_close(competing)
        require((try ledger.read(other)!["positionMs"] as! NSNumber).doubleValue == 500000, "Busy failure lost prior commit")
        // Inactive commands must not supersede the active owner's playback lease.
        let stateCommand = try ledger.setExplicit(scope, positionMs: 0, durationMs: 10000000, finished: false, reason: "mark-unread", commandId: "unread-1")
        let stillLive = try save(ledger, second, 700000)
        require((stillLive["positionMs"] as! NSNumber).doubleValue == 700000, "Inactive command stole live ownership")
        let repeated = try ledger.setExplicit(scope, positionMs: 0, durationMs: 10000000, finished: false, reason: "mark-unread", commandId: "unread-1")
        require((stateCommand["sequence"] as! NSNumber).int64Value == (repeated["sequence"] as! NSNumber).int64Value, "Command replay was not idempotent")
        // SQLite itself rejects a failed INSERT/UPDATE; API must not issue a receipt.
        sqlite3_open(path, &competing)
        sqlite3_exec(competing, "CREATE TRIGGER inject_write_failure BEFORE UPDATE ON positions BEGIN SELECT RAISE(ABORT, 'injected I/O failure'); END", nil, nil, nil)
        do { _ = try save(ledger, second, 800000); fatalError("SQLite failure reported success") } catch {}
        require((try ledger.read(other)!["positionMs"] as! NSNumber).doubleValue == 700000, "Failed transaction lost previous record")
        sqlite3_exec(competing, "DROP TRIGGER inject_write_failure", nil, nil, nil)
        sqlite3_close(competing)
        let latestLive = try save(ledger, second, 710000)
        let olderSequence = (stillLive["sequence"] as! NSNumber).int64Value
        let delayedAck = try ledger.acknowledge(other, sequence: olderSequence, kind: "synced")!
        require((delayedAck["sequence"] as! NSNumber).int64Value == (latestLive["sequence"] as! NSNumber).int64Value, "Delayed acknowledgement replaced latest sequence")
        require((delayedAck["positionMs"] as! NSNumber).doubleValue == 710000, "Delayed acknowledgement changed position")
        require((delayedAck["syncedThroughSequence"] as! NSNumber).int64Value < (delayedAck["sequence"] as! NSNumber).int64Value, "Old revision acknowledgement cleared latest intent")
        do { _ = try ledger.acknowledge(other, sequence: Int64.max, kind: "synced"); fatalError("Future acknowledgement accepted") } catch ListeningLedgerError.invalid {}
        require(try ledger.confirmedCommandRecord(scope, commandId: "unread-1") != nil, "Confirmed command identity lost")
        let replacementAdapter = try ListeningPositionLedger(path: path)
        let replaced = try replacementAdapter.activate(other)
        _ = try save(replacementAdapter, replaced, 720000)
        do { _ = try save(ledger, second, 730000); fatalError("Older adapter bypassed persisted ownership fence") } catch ListeningLedgerError.stale {}
        do { _ = try ledger.beginRelocation(second, target: 0, commandId: "stale-adapter-seek"); fatalError("Older adapter bypassed seek fence") } catch ListeningLedgerError.stale {}
        print("Ledger ownership, ordering, pending-command, rewind, acknowledgement, paused-restart, invalid-input and SQLite-busy tests passed")
    }
}
