import Foundation

/// User intent is independent of transport and survives asynchronous preparation.
final class RequestedPlaybackState {
    private(set) var playing = false
    private(set) var commandId: String?
    private(set) var targetId: String?
    private(set) var revision: Int64 = 0
    var loadedTargetId: String?
    var startAllowed = false
    var interrupted = false

    func request(_ playing: Bool, commandId: String? = nil, targetId: String? = nil) {
        self.playing = playing
        if let commandId { self.commandId = commandId }
        if let targetId { self.targetId = targetId }
        revision += 1
        if !playing { startAllowed = false }
    }

    var mayStart: Bool {
        playing && startAllowed && !interrupted && targetId == loadedTargetId
    }

    func allowStart(commandId: String) -> Bool {
        guard self.commandId == commandId, playing else { return false }
        startAllowed = true
        return mayStart
    }

    func endInterruption(shouldResume: Bool) {
        interrupted = false
        if !shouldResume { request(false) }
    }
}
