import Foundation

@main
struct RequestedPlaybackStateTests {
    static func main() {
        let request = RequestedPlaybackState()
        request.request(true, commandId: "play-a", targetId: "a")
        request.loadedTargetId = "a"
        precondition(!request.mayStart, "JS requested Play cannot start before preparation is released")
        precondition(request.allowStart(commandId: "play-a"))
        request.request(false, commandId: "pause-a")
        precondition(!request.allowStart(commandId: "play-a"), "An old Play completion must not override Pause")
        request.request(true, commandId: "play-a-again")
        precondition(!request.allowStart(commandId: "play-a"))
        precondition(request.allowStart(commandId: "play-a-again"))
        request.request(false) // Headphone Pause while the same load is preparing.
        precondition(!request.allowStart(commandId: "play-a-again"), "Remote Pause must win even before JS receives it")
        precondition(request.commandId == "play-a-again", "Native request retains the JS acknowledgment fence")
        request.request(true, commandId: "play-b", targetId: "b")
        request.startAllowed = true // Explicit headset Play before B metadata returns.
        precondition(!request.mayStart, "B's remote Play must never start loaded A")
        request.loadedTargetId = "b"
        precondition(request.mayStart)
        request.interrupted = true
        precondition(!request.mayStart, "Readiness cannot override an interruption")
        request.request(false)
        request.endInterruption(shouldResume: true)
        precondition(!request.mayStart, "Pause during interruption prevents automatic resume")
        request.request(true)
        request.startAllowed = true
        request.interrupted = true
        request.endInterruption(shouldResume: false)
        precondition(!request.playing && !request.mayStart, "OS refusal requires explicit Play")
        request.request(true)
        request.startAllowed = true
        request.interrupted = true
        request.endInterruption(shouldResume: true)
        precondition(request.mayStart, "OS permission and unchanged Play intent permit resume")
        let revision = request.revision
        request.request(true)
        precondition(request.playing && request.revision > revision, "Repeated explicit Play is idempotent")
        print("Requested playback native policy tests passed")
    }
}
