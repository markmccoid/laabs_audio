package dev.rnap.reactnativeaudiopro

/** User intent survives preparation and is distinct from ExoPlayer transport. */
internal class RequestedPlaybackState {
    var playing = false
        private set
    var commandId: String? = null
        private set
    var targetId: String? = null
        private set
    var revision = 0L
        private set
    var loadedTargetId: String? = null
    var startAllowed = false
    var interrupted = false
    fun request(playing: Boolean, commandId: String? = null, targetId: String? = null) {
        this.playing = playing
        if (commandId != null) this.commandId = commandId
        if (targetId != null) this.targetId = targetId
        revision++
        if (!playing) startAllowed = false
    }
    val mayStart: Boolean
        get() = playing && startAllowed && !interrupted && targetId == loadedTargetId
    fun allowStart(commandId: String): Boolean {
        if (this.commandId != commandId || !playing) return false
        startAllowed = true
        return mayStart
    }
}
