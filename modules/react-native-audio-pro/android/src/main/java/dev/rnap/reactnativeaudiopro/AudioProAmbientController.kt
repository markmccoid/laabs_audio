package dev.rnap.reactnativeaudiopro

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * AudioProAmbientController
 *
 * A completely isolated controller for ambient audio playback.
 * This controller is separate from the main AudioProController and does not
 * share any state, events, or resources with it.
 */
object AudioProAmbientController {
	private const val TAG = "[react-native-audio-pro]"
	private const val AMBIENT_EVENT_NAME = "AudioProAmbientEvent"
	private const val EVENT_TYPE_AMBIENT_TRACK_ENDED = "AMBIENT_TRACK_ENDED"
	private const val EVENT_TYPE_AMBIENT_ERROR = "AMBIENT_ERROR"
	private const val EVENT_TYPE_AMBIENT_PROGRESS = "AMBIENT_PROGRESS"
	private const val AMBIENT_PROGRESS_INTERVAL_MS = 1000L

	private var reactContext: ReactApplicationContext? = null
	private var enginePlayerAmbient: ExoPlayer? = null
	private var engineListenerAmbient: Player.Listener? = null
	private var settingDebugAmbient: Boolean = false
	private var settingLoopAmbient: Boolean = true
	private var settingVolumeAmbient: Float = 1.0f
	private val progressHandlerAmbient = Handler(Looper.getMainLooper())
	private var progressRunnableAmbient: Runnable? = null

	/**
	 * Set the React context
	 */
	fun setReactContext(context: ReactApplicationContext?) {
		reactContext = context
	}

	/**
	 * Log a message if debug is enabled
	 */
	private fun log(vararg args: Any?) {
		if (settingDebugAmbient) {
			Log.d(TAG, "${args.joinToString(" ")}")
		}
	}

	/**
	 * Play an ambient audio track
	 */
	fun ambientPlay(options: ReadableMap) {
		val optionUrl = options.getString("url") ?: run {
			emitAmbientError("Invalid URL provided to ambientPlay()")
			return
		}

		if (options.hasKey("debug")) settingDebugAmbient = options.getBoolean("debug")

		val optionLoop = if (options.hasKey("loop")) options.getBoolean("loop") else true
		settingLoopAmbient = optionLoop

		// Log all options for debugging
		log(
			"Ambient options parsed:",
			"url=$optionUrl",
			"loop=$optionLoop"
		)

		// Stop any existing ambient playback
		ambientStop()

		// Create a new player
		val context = reactContext ?: run {
			emitAmbientError("React context is not set")
			return
		}

		runOnUiThread {
			enginePlayerAmbient = ExoPlayer.Builder(context).build().apply {
				// Set up player
				repeatMode =
					if (settingLoopAmbient) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF

				// Set up listener
				engineListenerAmbient = object : Player.Listener {
					override fun onPlaybackStateChanged(state: Int) {
						if (state == Player.STATE_READY) {
							// Duration is C.TIME_UNSET until the item is ready, so this is
							// the first tick that can tell JS how long the loop actually is.
							emitAmbientProgress()
						}
						if (state == Player.STATE_ENDED && !settingLoopAmbient) {
							// If playback ended and loop is disabled, emit event and clean up
							emitAmbientTrackEnded()
							ambientStop()
						}
					}

					override fun onPositionDiscontinuity(
						oldPosition: Player.PositionInfo,
						newPosition: Player.PositionInfo,
						reason: Int,
					) {
						// Includes the wrap back to 0 under REPEAT_MODE_ONE — report it
						// immediately so JS never extrapolates past the end of the file.
						emitAmbientProgress()
					}

					override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
						emitAmbientError(error.message ?: "Unknown ambient playback error")
						ambientStop()
					}
				}
				addListener(engineListenerAmbient!!)

				// Prepare media item
				// Parse the URL string into a Uri object to properly handle all URI schemes including file://
				val uri = android.net.Uri.parse(optionUrl)
				log("Parsed ambient URI: $uri, scheme: ${uri.scheme}")

				val mediaItem = MediaItem.Builder()
					.setUri(uri)
					.build()

				setMediaItem(mediaItem)
				prepare()
				volume = settingVolumeAmbient
				play()
			}

			startAmbientProgressTicker()
		}
	}

	/**
	 * Stop ambient audio playback
	 */
	fun ambientStop() {
		log("Ambient Stop")

		stopAmbientProgressTicker()

		runOnUiThread {
			enginePlayerAmbient?.let { exo ->
				engineListenerAmbient?.let { exo.removeListener(it) }
				exo.stop()
				exo.release()
			}
			enginePlayerAmbient = null
			engineListenerAmbient = null
		}
	}

	/**
	 * Pause ambient audio playback
	 * No-op if already paused or not playing
	 */
	fun ambientPause() {
		log("Ambient Pause")

		runOnUiThread {
			enginePlayerAmbient?.pause()
			// Report the resting position before the ticker stops so JS records
			// where we actually paused instead of extrapolating past it.
			emitAmbientProgress()
			stopAmbientProgressTicker()
		}
	}

	/**
	 * Resume ambient audio playback
	 * No-op if already playing or no active track
	 */
	fun ambientResume() {
		log("Ambient Resume")

		runOnUiThread {
			enginePlayerAmbient?.play()
			startAmbientProgressTicker()
		}
	}

	/**
	 * Seek to position in ambient audio track
	 * Silently ignore if not supported or no active track
	 *
	 * @param positionMs Position in milliseconds
	 */
	fun ambientSeekTo(positionMs: Long) {
		runOnUiThread {
			val exo = enginePlayerAmbient ?: return@runOnUiThread

			// A resume position saved across loops can exceed the file length,
			// and seeking past the end lands on the last frame (which ends the
			// item immediately). Wrap it into the track instead. Duration is
			// C.TIME_UNSET until the item is ready, so fall back to the request.
			val duration = exo.duration
			var target = positionMs.coerceAtLeast(0L)
			if (duration > 0 && target >= duration) {
				target %= duration
			}

			log("Ambient Seek To", positionMs, "resolved:", target)
			exo.seekTo(target)
			emitAmbientProgress()
		}
	}

	/**
	 * Set the volume of ambient audio playback
	 */
	fun ambientSetVolume(volume: Float) {
		settingVolumeAmbient = volume
		log("Ambient Set Volume", volume)

		runOnUiThread {
			enginePlayerAmbient?.volume = volume
		}
	}

	/**
	 * Emit the ambient player's real position and duration.
	 *
	 * Ambient audio has no state tracking, so JS previously had to estimate the
	 * position from a wall clock — which never wrapped at the end of a looping
	 * file and drifted whenever the player was not actually advancing.
	 *
	 * Must be called on the UI thread (where the ExoPlayer instance lives).
	 */
	private fun emitAmbientProgress() {
		val exo = enginePlayerAmbient ?: return

		// duration is C.TIME_UNSET (negative) until the item is ready; report 0
		// so JS treats the loop length as unknown rather than nonsense.
		val duration = exo.duration
		val payload = Arguments.createMap().apply {
			putDouble("position", exo.currentPosition.coerceAtLeast(0L).toDouble())
			putDouble("duration", if (duration > 0) duration.toDouble() else 0.0)
		}

		emitAmbientEvent(EVENT_TYPE_AMBIENT_PROGRESS, payload)
	}

	private fun startAmbientProgressTicker() {
		stopAmbientProgressTicker()

		val runnable = object : Runnable {
			override fun run() {
				emitAmbientProgress()
				progressHandlerAmbient.postDelayed(this, AMBIENT_PROGRESS_INTERVAL_MS)
			}
		}
		progressRunnableAmbient = runnable
		progressHandlerAmbient.post(runnable)
	}

	private fun stopAmbientProgressTicker() {
		progressRunnableAmbient?.let { progressHandlerAmbient.removeCallbacks(it) }
		progressRunnableAmbient = null
	}

	/**
	 * Emit an ambient track ended event
	 */
	private fun emitAmbientTrackEnded() {
		log("Ambient Track Ended")
		emitAmbientEvent(EVENT_TYPE_AMBIENT_TRACK_ENDED, null)
	}

	/**
	 * Emit an ambient error event
	 */
	private fun emitAmbientError(message: String) {
		log("Ambient Error:", message)

		val payload = Arguments.createMap().apply {
			putString("error", message)
		}

		emitAmbientEvent(EVENT_TYPE_AMBIENT_ERROR, payload)
	}

	/**
	 * Emit an ambient event
	 */
	private fun emitAmbientEvent(type: String, payload: WritableMap?) {
		val context = reactContext
		if (context is ReactApplicationContext) {
			val body = Arguments.createMap().apply {
				putString("type", type)

				if (payload != null) {
					putMap("payload", payload)
				}
			}

			context
				.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
				.emit(AMBIENT_EVENT_NAME, body)
		} else {
			Log.w(TAG, "Context is not an instance of ReactApplicationContext")
		}
	}

	/**
	 * Run a block on the UI thread
	 */
	private fun runOnUiThread(block: () -> Unit) {
		Handler(Looper.getMainLooper()).post(block)
	}
}
