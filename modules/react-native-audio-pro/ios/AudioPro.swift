import Foundation
import AVFoundation
import React
import MediaPlayer
import UIKit

@objc(AudioPro)
class AudioPro: RCTEventEmitter {

	////////////////////////////////////////////////////////////
	// MARK: - Properties & Constants
	////////////////////////////////////////////////////////////

	private var player: AVPlayer?
	private var timer: Timer?
	private var hasListeners = false
	private let EVENT_NAME = "AudioProEvent"
	private let AMBIENT_EVENT_NAME = "AudioProAmbientEvent"

	private var ambientPlayer: AVPlayer?
	private var ambientPlayerItem: AVPlayerItem?


	// Event types
	private let EVENT_TYPE_STATE_CHANGED = "STATE_CHANGED"
	private let EVENT_TYPE_TRACK_ENDED = "TRACK_ENDED"
	private let EVENT_TYPE_PLAYBACK_ERROR = "PLAYBACK_ERROR"
	private let EVENT_TYPE_PROGRESS = "PROGRESS"
	private let EVENT_TYPE_SEEK_COMPLETE = "SEEK_COMPLETE"
	private let EVENT_TYPE_REMOTE_NEXT = "REMOTE_NEXT"
	private let EVENT_TYPE_REMOTE_PREV = "REMOTE_PREV"
	private let EVENT_TYPE_PLAYBACK_SPEED_CHANGED = "PLAYBACK_SPEED_CHANGED"

	// Seek trigger sources
	private let TRIGGER_SOURCE_USER = "USER"
	private let TRIGGER_SOURCE_SYSTEM = "SYSTEM"

	// Ambient audio event types
	private let EVENT_TYPE_AMBIENT_TRACK_ENDED = "AMBIENT_TRACK_ENDED"
	private let EVENT_TYPE_AMBIENT_ERROR = "AMBIENT_ERROR"

	// States
	private let STATE_IDLE = "IDLE"
	private let STATE_STOPPED = "STOPPED"
	private let STATE_LOADING = "LOADING"
	private let STATE_PLAYING = "PLAYING"
	private let STATE_PAUSED = "PAUSED"
	private let STATE_ERROR = "ERROR"

	private let GENERIC_ERROR_CODE = 900
	private var shouldBePlaying = false
	private var isRemoteCommandCenterSetup = false

	private var isRateObserverAdded = false
	private var isStatusObserverAdded = false

	private var currentPlaybackSpeed: Float = 1.0
	private var currentTrack: NSDictionary?

	private var settingDebug: Bool = false
	private var settingDebugIncludeProgress: Bool = false
	private var settingProgressInterval: TimeInterval = 1.0
	private var settingShowNextPrevControls = true
	private var settingShowSkipControls = false
	private var settingDisableLockScreenSeek = false
	private var settingLoopAmbient: Bool = true

	private var activeVolume: Float = 1.0
	private var activeVolumeAmbient: Float = 1.0

	private var isInErrorState: Bool = false
	private var lastEmittedState: String = ""
	private var wasPlayingBeforeInterruption: Bool = false
	private var pendingStartTimeMs: Double? = nil

	// When an audio-session interruption (e.g. an incoming text/call) pauses playback,
	// the JS layer's progress save is async and can be lost if iOS suspends/terminates the
	// app while it is backgrounded and no longer playing audio. To guarantee a durable save
	// point, we persist the paused position synchronously to UserDefaults the instant the
	// interruption begins. On the next play() for the same track (e.g. after a relaunch) we
	// use it as a resume floor so playback never resumes behind where the interruption paused.
	private let interruptionResumeDefaultsKey = "AudioProInterruptionResumeRecord"
	// Safety bound so a very old record can never reposition an unrelated future session.
	private let interruptionResumeMaxAgeSeconds: TimeInterval = 6 * 60 * 60
	private var settingSkipForwardIntervalMs: Double = 30000.0
	private var settingSkipBackwardIntervalMs: Double = 30000.0

	private func getDouble(_ value: Any?) -> Double? {
		if let number = value as? NSNumber {
			return number.doubleValue
		}
		if let doubleVal = value as? Double {
			return doubleVal
		}
		if let intVal = value as? Int {
			return Double(intVal)
		}
		return nil
	}

	private func getBool(_ value: Any?) -> Bool? {
		if let boolVal = value as? Bool {
			return boolVal
		}
		if let number = value as? NSNumber {
			return number.boolValue
		}
		if let intVal = value as? Int {
			return intVal != 0
		}
		return nil
	}

	////////////////////////////////////////////////////////////
	// MARK: - React Native Event Emitter Overrides
	////////////////////////////////////////////////////////////

	override func supportedEvents() -> [String]! {
		return [EVENT_NAME, AMBIENT_EVENT_NAME]
	}

	override static func requiresMainQueueSetup() -> Bool {
		return false
	}

	override func startObserving() {
		hasListeners = true
	}

	override func stopObserving() {
		hasListeners = false
	}

	private func setupAudioSessionInterruptionObserver() {
		// Register for audio session interruption notifications
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(handleAudioSessionInterruption(_:)),
			name: AVAudioSession.interruptionNotification,
			object: nil
		)

		log("Registered for audio session interruption notifications")
	}

	private func removeAudioSessionInterruptionObserver() {
		NotificationCenter.default.removeObserver(
			self,
			name: AVAudioSession.interruptionNotification,
			object: nil
		)
	}

	/// Synchronously persist the current playback position so it survives an app
	/// suspension/termination that can happen while audio is paused in the background.
	private func persistInterruptionResumePosition() {
		guard let trackId = currentTrack?["id"] as? String else { return }
		let positionMs = getPlaybackInfo().position
		guard positionMs > 0 else { return }

		let record: [String: Any] = [
			"trackId": trackId,
			"positionMs": positionMs,
			"timestamp": Date().timeIntervalSince1970,
		]
		UserDefaults.standard.set(record, forKey: interruptionResumeDefaultsKey)
		log("Persisted interruption resume position", positionMs, "for", trackId)
	}

	private func clearInterruptionResumePosition() {
		UserDefaults.standard.removeObject(forKey: interruptionResumeDefaultsKey)
	}

	/// Read and clear a persisted interruption position if it belongs to `trackId` and is
	/// still fresh. Returns the position in ms, or nil when there is nothing to apply.
	private func consumeInterruptionResumePosition(for trackId: String) -> Double? {
		guard let record = UserDefaults.standard.dictionary(forKey: interruptionResumeDefaultsKey),
			  let storedTrackId = record["trackId"] as? String,
			  storedTrackId == trackId,
			  let positionMs = record["positionMs"] as? Int,
			  let timestamp = record["timestamp"] as? TimeInterval else {
			return nil
		}

		// Matched this track: consume it regardless of freshness so it can't be reused.
		clearInterruptionResumePosition()

		guard Date().timeIntervalSince1970 - timestamp <= interruptionResumeMaxAgeSeconds else {
			log("Discarding stale interruption resume position for", trackId)
			return nil
		}

		return Double(positionMs)
	}

	@objc private func handleAudioSessionInterruption(_ notification: Notification) {
		guard let userInfo = notification.userInfo,
			  let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
			  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
			return
		}

		log("Audio session interruption: \(type)")

		switch type {
		case .began:
			// Interruption began (e.g., phone call, Siri, other app playing audio)
			wasPlayingBeforeInterruption = player?.rate != 0
			log("wasPlayingBeforeInterruption set to", wasPlayingBeforeInterruption)

			if wasPlayingBeforeInterruption {
				log("Interruption began while playing, pausing playback")
				// Pause playback without changing shouldBePlaying flag
				player?.pause()
				stopTimer()

				// Durably save the paused position before iOS can suspend/terminate the app.
				// The JS-side progress save is async and may not commit in time.
				persistInterruptionResumePosition()

				// Emit PAUSED state to ensure UI is in sync
				sendPausedStateEvent()

				// Update now playing info to show paused state
				updateNowPlayingInfo(time: player?.currentTime().seconds ?? 0, rate: 0)
			}

		case .ended:
			// Interruption ended
			guard let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt else {
				return
			}

			let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)

			log("wasPlayingBeforeInterruption at end:", wasPlayingBeforeInterruption)
			log("shouldResume:", options.contains(.shouldResume))

			// If playback should resume and we have permission to do so
			if wasPlayingBeforeInterruption && options.contains(.shouldResume) {
				log("Interruption ended with resume option, resuming playback")

				// Read (and clear) the position we saved when the interruption began so we can
				// guard against the player having lost its place across the interruption.
				let savedResumeMs = (currentTrack?["id"] as? String)
					.flatMap { consumeInterruptionResumePosition(for: $0) }

				// Try to reactivate the audio session
				do {
					try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)

					// If the player drifted behind where the interruption paused, restore it
					// before resuming so we never play back from an earlier position.
					if let savedResumeMs = savedResumeMs, let player = player {
						let currentMs = player.currentTime().seconds * 1000
						if currentMs.isFinite && currentMs < savedResumeMs - 1000 {
							log("Player drifted behind interruption point, seeking back to", savedResumeMs)
							performSeek(to: savedResumeMs, isAbsolute: true)
						}
					}

					// Resume playback
					player?.play()
					startProgressTimer()

					// Emit PLAYING state
					sendPlayingStateEvent()

					// Update now playing info
					updateNowPlayingInfo(time: player?.currentTime().seconds ?? 0, rate: 1.0)
				} catch {
					log("Failed to reactivate audio session: \(error.localizedDescription)")
					emitPlaybackError("Failed to resume after interruption: \(error.localizedDescription)")
				}
			} else {
				// Not resuming in-process (e.g. no shouldResume). Leave the saved position in
				// place so the next play()/relaunch can use it as a resume floor.
				log("Interruption ended without in-process resume; keeping saved resume position")
			}

			// Reset the flag
			wasPlayingBeforeInterruption = false
		@unknown default:
			break
		}
	}

	////////////////////////////////////////////////////////////
	// MARK: - Debug Logging Helper
	////////////////////////////////////////////////////////////

	private func log(_ items: Any...) {
		guard settingDebug else { return }

		if !settingDebugIncludeProgress && items.count > 0 {
			if let firstItem = items.first, "\(firstItem)" == EVENT_TYPE_PROGRESS {
				return
			}
		}

		print("~~~ [AudioPro]", items.map { "\($0)" }.joined(separator: " "))
	}

	private func sendEvent(type: String, track: Any?, payload: [String: Any]?) {
		guard hasListeners else { return }

		var body: [String: Any] = [
			"type": type,
			"track": track as Any
		]

		if let payload = payload {
			body["payload"] = payload
		}

		log(type)

		sendEvent(withName: EVENT_NAME, body: body)
	}


	////////////////////////////////////////////////////////////
	// MARK: - Timers & Progress Updates
	////////////////////////////////////////////////////////////

	private func startProgressTimer() {
		DispatchQueue.main.async {
			self.timer?.invalidate()
			self.sendProgressNoticeEvent()
			self.timer = Timer.scheduledTimer(withTimeInterval: self.settingProgressInterval, repeats: true) { [weak self] _ in
				self?.sendProgressNoticeEvent()
			}
		}
	}

	private func stopTimer() {
		DispatchQueue.main.async {
			self.timer?.invalidate()
			self.timer = nil
		}
	}

	private func sendProgressNoticeEvent() {
		guard let player = player, let _ = player.currentItem, player.rate != 0 else { return }
		let info = getPlaybackInfo()

		let payload: [String: Any] = [
			"position": info.position,
			"duration": info.duration
		]
		sendEvent(type: EVENT_TYPE_PROGRESS, track: info.track, payload: payload)
	}

	////////////////////////////////////////////////////////////
	// MARK: - Playback Control (Play, Pause, Resume, Stop)
	////////////////////////////////////////////////////////////

	/// Prepares the player for new playback without emitting state changes or destroying the media session
	/// - This function:
	/// - Pauses the player if it's playing
	/// - Removes KVO observers from the previous AVPlayerItem
	/// - Stops the progress timer
	/// - Does not emit any state or clear currentTrack
	/// - Does not destroy the media session
	private func prepareForNewPlayback() {
		// Pause the player if it's playing
		player?.pause()

		// Stop the progress timer
		stopTimer()

		// Remove KVO observers from the previous AVPlayerItem
		if let player = player {
			if isRateObserverAdded {
				player.removeObserver(self, forKeyPath: "rate")
				isRateObserverAdded = false
			}
			if let currentItem = player.currentItem, isStatusObserverAdded {
				currentItem.removeObserver(self, forKeyPath: "status")
				isStatusObserverAdded = false
			}
		}

		// Remove playback ended notification observer
		NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: player?.currentItem)
	}

	@objc(play:withOptions:)
	func play(track: NSDictionary, options: NSDictionary) {
		// Reset error state when playing a new track
		isInErrorState = false
		// Reset last emitted state when playing a new track
		lastEmittedState = ""
		currentTrack = track
		settingDebug = getBool(options["debug"]) ?? false
		settingDebugIncludeProgress = getBool(options["debugIncludesProgress"]) ?? false
		let speed = Float(getDouble(options["playbackSpeed"]) ?? 1.0)
		let volume = Float(getDouble(options["volume"]) ?? 1.0)
		let autoPlay = getBool(options["autoPlay"]) ?? true
		pendingStartTimeMs = getDouble(options["startTimeMs"])

		// If an interruption (e.g. an incoming text) paused this same track and the app was
		// suspended/terminated before its progress durably synced, the requested start time
		// can be an earlier (stale) save point. Use the position we saved at interruption time
		// as a floor so playback never resumes behind where it was actually paused.
		if let trackId = track["id"] as? String,
		   let savedResumeMs = consumeInterruptionResumePosition(for: trackId),
		   savedResumeMs > (pendingStartTimeMs ?? 0) {
			log("Applying interruption resume floor", savedResumeMs, "over requested start", pendingStartTimeMs ?? 0)
			pendingStartTimeMs = savedResumeMs
		}

		applyConfigurationSettings(options)

		if let progressIntervalMs = getDouble(options["progressIntervalMs"]) {
			let intervalSeconds = progressIntervalMs / 1000.0
			settingProgressInterval = intervalSeconds
		} else {
			settingProgressInterval = 1.0
		}

		currentPlaybackSpeed = speed
		activeVolume = volume
		log("Play", track["title"] ?? "Unknown", "speed:", speed, "volume:", volume, "autoPlay:", autoPlay)

		if player != nil {
			DispatchQueue.main.sync {
				// Prepare for new playback without emitting state changes or destroying the media session
				prepareForNewPlayback()
			}
		}

		guard
			let urlString = track["url"] as? String,
			let url = URL(string: urlString),
			let title = track["title"] as? String,
			let artworkUrlString = track["artwork"] as? String,
			let artworkUrl = URL(string: artworkUrlString)
		else {
			onError("Invalid track data")
			cleanup()
			return
		}

		do {
			let contentType = options["contentType"] as? String ?? "MUSIC"
			let mode: AVAudioSession.Mode = (contentType == "SPEECH") ? .spokenAudio : .default
			try AVAudioSession.sharedInstance().setCategory(.playback, mode: mode)
			try AVAudioSession.sharedInstance().setActive(true)

			// Set up audio session interruption observer
			setupAudioSessionInterruptionObserver()
		} catch {
			onError("Audio session setup failed: \(error.localizedDescription)")
			return
		}

		sendStateEvent(state: STATE_LOADING, position: 0, duration: 0, track: currentTrack)
		shouldBePlaying = autoPlay

		let album = track["album"] as? String
		let artist = track["artist"] as? String

		// Update now playing info without resetting the entire dictionary
		var nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
		nowPlayingInfo[MPMediaItemPropertyTitle] = title
		if let album = album {
			nowPlayingInfo[MPMediaItemPropertyAlbumTitle] = album
		}
		if let artist = artist {
			nowPlayingInfo[MPMediaItemPropertyArtist] = artist
		}
		MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo

		DispatchQueue.main.async {
			UIApplication.shared.beginReceivingRemoteControlEvents()
			self.setupRemoteTransportControls()
		}

		// Create new player item with custom headers if provided
		let item: AVPlayerItem

		// Check if audio headers are provided
		if let headers = options["headers"] as? NSDictionary, let audioHeaders = headers["audio"] as? NSDictionary {
			// Convert headers to Swift dictionary
			var headerFields = [String: String]()
			for (key, value) in audioHeaders {
				if let headerField = key as? String, let headerValue = value as? String {
					headerFields[headerField] = headerValue
				}
			}

			// Create an AVAsset with the headers
			let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headerFields])
			item = AVPlayerItem(asset: asset)
		} else {
			// No headers, use simple URL initialization
			item = AVPlayerItem(url: url)
		}

		// Pin the time-pitch algorithm so rates above 2.0 keep producing audio.
		// The pre-iOS-15 linkage default (LowQualityZeroLatency) snaps rates to a
		// fixed set capped at 2.0; timeDomain supports 1/32–32x and suits speech.
		item.audioTimePitchAlgorithm = .timeDomain

		// Add observer to the new item
		item.addObserver(self, forKeyPath: "status", options: [.new], context: nil)
		isStatusObserverAdded = true

		// Create the AVPlayer if it doesn't exist, otherwise just replace the item
		if player == nil {
			// Create a new AVPlayer instance
			player = AVPlayer(playerItem: item)
		} else {
			// Replace the current item with the new one
			player?.replaceCurrentItem(with: item)
		}

		// Add rate observer to the player
		player?.addObserver(self, forKeyPath: "rate", options: [.new], context: nil)
		isRateObserverAdded = true

		// Set up volume to ensure it's applied before playback starts
		player?.volume = activeVolume

		updateNowPlayingInfo(time: 0, rate: 1.0, duration: item.asset.duration.seconds)

		// Add notification observer for track completion to the new item
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(playerItemDidPlayToEndTime(_:)),
			name: .AVPlayerItemDidPlayToEndTime,
			object: item
		)

		// Set up playback speed
		if currentPlaybackSpeed != 1.0 {
			player?.rate = currentPlaybackSpeed

			var currentInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
			currentInfo[MPNowPlayingInfoPropertyPlaybackRate] = Double(currentPlaybackSpeed)
			MPNowPlayingInfoCenter.default().nowPlayingInfo = currentInfo
		}

		if autoPlay {
			player?.play()
		} else {
			DispatchQueue.main.async {
				self.sendStateEvent(state: self.STATE_PAUSED, position: 0, duration: 0, track: self.currentTrack)
			}
		}

		DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
			// Don't emit PLAYING state if we're in an error state
			if self.isInErrorState {
				self.log("Ignoring delayed PLAYING state after ERROR")
				return
			}

			if self.player?.rate != 0 && self.hasListeners {
				// Use sendPlayingStateEvent to ensure lastEmittedState is updated
				self.sendPlayingStateEvent()
				self.startProgressTimer()
			}
		}

		// Fetch artwork asynchronously and update Now Playing info
		DispatchQueue.global().async {
			do {
				// Check if artwork headers are provided
				if let headers = options["headers"] as? NSDictionary, let artworkHeaders = headers["artwork"] as? NSDictionary {
					// Create a simple URL request with headers
					var request = URLRequest(url: artworkUrl)
					for (key, value) in artworkHeaders {
						if let headerField = key as? String, let headerValue = value as? String {
							request.setValue(headerValue, forHTTPHeaderField: headerField)
						}
					}

					// Use a semaphore to make the async call synchronous in this background thread
					let semaphore = DispatchSemaphore(value: 0)
					var imageData: Data? = nil
					var requestError: Error? = nil

					URLSession.shared.dataTask(with: request) { (data, response, error) in
						imageData = data
						requestError = error
						semaphore.signal()
					}.resume()

					// Wait for the request to complete
					semaphore.wait()

					if let error = requestError {
						throw error
					}

					guard let data = imageData else {
						throw NSError(domain: "AudioPro", code: 0, userInfo: [NSLocalizedDescriptionKey: "No image data received"])
					}

					guard let image = UIImage(data: data) else {
						throw NSError(domain: "AudioPro", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid image data"])
					}

					let mpmArtwork = MPMediaItemArtwork(boundsSize: image.size, requestHandler: { _ in image })
					DispatchQueue.main.async {
						var currentInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
						currentInfo[MPMediaItemPropertyArtwork] = mpmArtwork
						MPNowPlayingInfoCenter.default().nowPlayingInfo = currentInfo
					}
				} else {
					// No headers, use simple Data initialization
					let data = try Data(contentsOf: artworkUrl)
					guard let image = UIImage(data: data) else {
						throw NSError(domain: "AudioPro", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid image data"])
					}
					let mpmArtwork = MPMediaItemArtwork(boundsSize: image.size, requestHandler: { _ in image })
					DispatchQueue.main.async {
						var currentInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
						currentInfo[MPMediaItemPropertyArtwork] = mpmArtwork
						MPNowPlayingInfoCenter.default().nowPlayingInfo = currentInfo
					}
				}
			} catch {
				DispatchQueue.main.async {
					self.onError(error.localizedDescription)
					self.cleanup()
				}
			}
		}
	}

	@objc(updateConfiguration:)
	func updateConfiguration(options: NSDictionary) {
		DispatchQueue.main.async { [weak self] in
			guard let self = self else { return }
			self.applyConfigurationSettings(options)
			UIApplication.shared.beginReceivingRemoteControlEvents()
			self.applyRemoteTransportControlSettings(MPRemoteCommandCenter.shared())
			self.refreshNowPlayingInfoForCurrentConfiguration()
		}
	}

	private func applyConfigurationSettings(_ options: NSDictionary) {
		if let debug = getBool(options["debug"]) {
			settingDebug = debug
		}

		if let debugIncludesProgress = getBool(options["debugIncludesProgress"]) {
			settingDebugIncludeProgress = debugIncludesProgress
		}

		if let remoteCommandMode = options["remoteCommandMode"] as? String {
			switch remoteCommandMode {
			case "next-prev":
				settingShowNextPrevControls = true
				settingShowSkipControls = false
			case "skip-intervals":
				settingShowNextPrevControls = false
				settingShowSkipControls = true
			case "none":
				settingShowNextPrevControls = false
				settingShowSkipControls = false
			default:
				break
			}
		} else {
			if let showNextPrevControls = getBool(options["showNextPrevControls"]) {
				settingShowNextPrevControls = showNextPrevControls
			}
			if let showSkipControls = getBool(options["showSkipControls"]) {
				settingShowSkipControls = showSkipControls
			}
			if settingShowNextPrevControls && settingShowSkipControls {
				settingShowSkipControls = false
			}
		}

		if let disableLockScreenSeek = getBool(options["disableLockScreenSeek"]) {
			settingDisableLockScreenSeek = disableLockScreenSeek
		}

		if let skipIntervalMs = getDouble(options["skipIntervalMs"]) {
			settingSkipForwardIntervalMs = skipIntervalMs
			settingSkipBackwardIntervalMs = skipIntervalMs
		}

		if let skipForwardIntervalMs = getDouble(options["skipForwardIntervalMs"]) {
			settingSkipForwardIntervalMs = skipForwardIntervalMs
		}

		if let skipBackwardIntervalMs = getDouble(options["skipBackwardIntervalMs"]) {
			settingSkipBackwardIntervalMs = skipBackwardIntervalMs
		}

		log(
			"Remote command settings:",
			"nextPrev=\(settingShowNextPrevControls)",
			"skip=\(settingShowSkipControls)",
			"seekDisabled=\(settingDisableLockScreenSeek)",
			"forwardMs=\(settingSkipForwardIntervalMs)",
			"backwardMs=\(settingSkipBackwardIntervalMs)"
		)
	}

	@objc(pause)
	func pause() {
		shouldBePlaying = false
		player?.pause()
		stopTimer()
		sendPausedStateEvent()
		updateNowPlayingInfo(time: player?.currentTime().seconds ?? 0, rate: 0)
	}

	@objc(resume)
	func resume() {
		shouldBePlaying = true

		// Try to reactivate the audio session if needed
		do {
			if !AVAudioSession.sharedInstance().isOtherAudioPlaying {
				try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
			}
		} catch {
			log("Failed to reactivate audio session: \(error.localizedDescription)")
			// Continue anyway, as the play command might still work
		}

		player?.play()

		// Ensure lock screen controls are properly updated
		updateNowPlayingInfo(time: player?.currentTime().seconds ?? 0, rate: 1.0)

		// Note: We don't need to call sendPlayingStateEvent() here because
		// the rate change will trigger observeValue which now calls sendPlayingStateEvent()
	}

	/// stop is meant to halt playback and update the state without destroying persistent info
	/// such as artwork and remote control settings. This allows the lock screen/Control Center
	/// to continue displaying the track details for a potential resume.
	@objc func stop() {
		// Reset error state when explicitly stopping
		isInErrorState = false
		// Reset last emitted state when stopping playback
		lastEmittedState = ""
		shouldBePlaying = false

		pendingStartTimeMs = nil

		player?.pause()
		player?.seek(to: .zero)
		stopTimer()
		// Do not set currentTrack = nil as STOPPED state should preserve track metadata
		sendStoppedStateEvent()

		// Update now playing info to reflect a stopped state but keep the artwork intact.
		updateNowPlayingInfo(time: 0, rate: 0)
	}

	/// Resets the player to IDLE state, fully tears down the player instance,
	/// and removes all media sessions.
	@objc(clear)
	func clear() {
		log("Clear called")
		resetInternal(STATE_IDLE)
	}

	/// Shared internal function that performs the teardown and emits the correct state.
	/// Used by both clear() and error transitions.
	/// - Parameter finalState: The state to emit after resetting (IDLE or ERROR)
	private func resetInternal(_ finalState: String) {
		// Reset error state
		isInErrorState = finalState == STATE_ERROR
		// Reset last emitted state
		lastEmittedState = ""
		shouldBePlaying = false

		// Reset volume to default
		activeVolume = 1.0

		pendingStartTimeMs = nil

		// Stop playback
		player?.pause()

		// Clear track and stop timers
		stopTimer()
		currentTrack = nil

		// Release resources and remove observers
		// We've already cleared currentTrack, so we don't need to do it again in cleanup
		cleanup(emitStateChange: false, clearTrack: false)

		// Emit the final state
		// Explicitly pass nil as the track parameter to ensure the state is emitted consistently
		sendStateEvent(state: finalState, position: 0, duration: 0, track: nil)
	}

	/// cleanup fully tears down the player instance and removes observers and remote controls.
	/// This is used when switching tracks or recovering from an error.
	/// - Parameter emitStateChange: Whether to emit a STOPPED state change event (default: true)
	/// - Parameter clearTrack: Whether to clear the currentTrack (default: true)
	@objc func cleanup(emitStateChange: Bool = true, clearTrack: Bool = true) {
		log("Cleanup", "emitStateChange:", emitStateChange, "clearTrack:", clearTrack)

		// Reset pending start time
		pendingStartTimeMs = nil

		shouldBePlaying = false

		NotificationCenter.default.removeObserver(self)

		// Explicitly remove audio session interruption observer
		removeAudioSessionInterruptionObserver()

		if let player = player {
			if isRateObserverAdded {
				player.removeObserver(self, forKeyPath: "rate")
				isRateObserverAdded = false
			}
			if let currentItem = player.currentItem, isStatusObserverAdded {
				currentItem.removeObserver(self, forKeyPath: "status")
				isStatusObserverAdded = false
			}
		}

		player?.pause()
		player = nil

		stopTimer()

		// Only clear the track if requested
		if clearTrack {
			currentTrack = nil
		}

		// Only emit state change if requested and not in error state
		if emitStateChange && !isInErrorState {
			sendStoppedStateEvent()
		}

		// Clear the now playing info and remote control events
		DispatchQueue.main.async {
			MPNowPlayingInfoCenter.default().nowPlayingInfo = [:]
			UIApplication.shared.endReceivingRemoteControlEvents()
			self.removeRemoteTransportControls()
			self.isRemoteCommandCenterSetup = false
		}
	}

	////////////////////////////////////////////////////////////
	// MARK: - Seeking Methods
	////////////////////////////////////////////////////////////

	/// Common seek implementation used by all seek methods
	private func performSeek(to position: Double, isAbsolute: Bool = true) {
		guard let player = player else {
			onError("Cannot seek: no track is playing")
			return
		}

		guard let currentItem = player.currentItem else {
			onError("Cannot seek: no item loaded")
			return
		}

		let duration = currentItem.duration.seconds
		let currentTime = player.currentTime().seconds

		// For relative seeking (forward/back), we need valid current time
		if !isAbsolute && (currentTime.isNaN || currentTime.isInfinite) {
			onError("Cannot seek: invalid track position")
			return
		}

		// For all seeks, we need valid duration
		if duration.isNaN || duration.isInfinite {
			onError("Cannot seek: invalid track duration")
			return
		}

		stopTimer()

		// Calculate target position based on whether this is absolute or relative
		let targetPosition: Double
		if isAbsolute {
			// For seekTo, convert ms to seconds
			targetPosition = position / 1000.0
		} else {
			// For seekForward/Back, position is the amount in ms
			let amountInSeconds = position / 1000.0
			targetPosition = (position >= 0) ? min(currentTime + amountInSeconds, duration) :
											  max(0, currentTime + amountInSeconds)
		}

		// Ensure position is within valid range
		let validPosition = max(0, min(targetPosition, duration))
		let time = CMTime(seconds: validPosition, preferredTimescale: 1000)
		let targetPositionMs = validPosition * 1000
		let completionToleranceSeconds = 0.05 // Allow small drift when AVPlayer reports interrupted completion

		let executeSeek = { [weak self] in
			guard let self = self else { return }

			// Cancel any pending seeks before issuing a new one to avoid AVPlayer interrupting the callback
			currentItem.cancelPendingSeeks()

			player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
				guard let self = self else { return }

				let currentTime = player.currentTime().seconds
				let isEffectivelyAtTarget = abs(currentTime - validPosition) <= completionToleranceSeconds

				if completed || isEffectivelyAtTarget {
					self.updateNowPlayingInfoWithCurrentTime(validPosition)
					self.completeSeekingAndSendSeekCompleteNoticeEvent(newPosition: targetPositionMs)

					// Force update the now playing info to ensure controls work
					if isAbsolute { // Only do this for absolute seeks to avoid redundant updates
						DispatchQueue.main.async {
							self.updateNowPlayingInfo(time: validPosition, rate: player.rate)
						}
					}
				} else if player.rate != 0 {
					self.startProgressTimer()
				}
			}
		}

		if Thread.isMainThread {
			executeSeek()
		} else {
			DispatchQueue.main.async(execute: executeSeek)
		}
	}

	@objc(seekTo:)
	func seekTo(position: Double) {
		performSeek(to: position, isAbsolute: true)
	}

	@objc(seekForward:)
	func seekForward(amount: Double) {
		performSeek(to: amount, isAbsolute: false)
	}

	@objc(seekBack:)
	func seekBack(amount: Double) {
		performSeek(to: -amount, isAbsolute: false)
	}


	private func completeSeekingAndSendSeekCompleteNoticeEvent(newPosition: Double) {
		if hasListeners {
			let info = getPlaybackInfo()

			let payload: [String: Any] = [
				"position": info.position,
				"duration": info.duration,
				"triggeredBy": TRIGGER_SOURCE_USER
			]
			sendEvent(type: EVENT_TYPE_SEEK_COMPLETE, track: info.track, payload: payload)
		}
		if player?.rate != 0 {
			// Resume progress timer after a short delay to ensure UI is in sync
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
				self.startProgressTimer()
			}
		}
	}

	////////////////////////////////////////////////////////////
	// MARK: - Playback Speed
	////////////////////////////////////////////////////////////

	@objc(setPlaybackSpeed:)
	func setPlaybackSpeed(speed: Double) {
		currentPlaybackSpeed = Float(speed)

		guard let player = player else {
			onError("Cannot set playback speed: no track is playing")
			return
		}

		log("Setting playback speed to ", speed)
		player.rate = Float(speed)

		updateNowPlayingInfo(rate: Float(speed))

		if hasListeners {
			let playbackInfo = getPlaybackInfo()
			let payload: [String: Any] = ["speed": speed]
			sendEvent(type: EVENT_TYPE_PLAYBACK_SPEED_CHANGED, track: playbackInfo.track, payload: payload)
		}
	}

	@objc(setVolume:)
	func setVolume(volume: Double) {
		activeVolume = Float(volume)

		guard let player = player else {
			log("Cannot set volume: no track is playing")
			return
		}

		log("Setting volume to ", volume)
		player.volume = Float(volume)
	}

	////////////////////////////////////////////////////////////
	// MARK: - KVO & Notification Handlers
	////////////////////////////////////////////////////////////

	/**
	 * Handles track completion according to the contract in logic.md:
	 * - Native is responsible for detecting the end of a track
	 * - Native must pause the player, seek to position 0, and emit both:
	 *   - STATE_CHANGED: STOPPED
	 *   - TRACK_ENDED
	 */
	@objc private func playerItemDidPlayToEndTime(_ notification: Notification) {
		guard let _ = player?.currentItem else { return }

		if isInErrorState {
			log("Ignoring track end notification while in ERROR state")
			return
		}

		let info = getPlaybackInfo()

		isInErrorState = false
		lastEmittedState = ""
		shouldBePlaying = false

		player?.seek(to: .zero)
		stopTimer()

		updateNowPlayingInfo(time: 0, rate: 0)

		sendStateEvent(state: STATE_STOPPED, position: 0, duration: info.duration, track: currentTrack)

		if hasListeners {
			let payload: [String: Any] = [
				"position": info.duration,
				"duration": info.duration
			]
			sendEvent(type: EVENT_TYPE_TRACK_ENDED, track: currentTrack, payload: payload)
		}
	}

	override func observeValue(
		forKeyPath keyPath: String?,
		of object: Any?,
		change: [NSKeyValueChangeKey: Any]?,
		context: UnsafeMutableRawPointer?
	) {
		// Guard against state changes while in error state
		guard !isInErrorState else {
			log("Ignoring state change while in ERROR state")
			return
		}

		guard let keyPath = keyPath else { return }

		switch keyPath {
		case "status":
			if let item = object as? AVPlayerItem {
				switch item.status {
				case .readyToPlay:
					log("Player item ready to play")
					if let pendingStartTimeMs = pendingStartTimeMs {
						performSeek(to: pendingStartTimeMs, isAbsolute: true)
						self.pendingStartTimeMs = nil
					}
				case .failed:
					if let error = item.error {
						onError("Player item failed: \(error.localizedDescription)")
					} else {
						onError("Player item failed with unknown error")
					}
				case .unknown:
					break
				@unknown default:
					break
				}
			}
		case "rate":
			if let newRate = change?[.newKey] as? Float {
				if newRate == 0 {
					if shouldBePlaying && hasListeners {
						let info = getPlaybackInfo()
						sendStateEvent(state: STATE_LOADING, position: info.position, duration: info.duration, track: info.track)
						stopTimer()
					}
				} else {
					if shouldBePlaying && hasListeners {
						// Use sendPlayingStateEvent to ensure lastEmittedState is updated
						sendPlayingStateEvent()
						startProgressTimer()
					}
				}
			}
		default:
			super.observeValue(forKeyPath: keyPath, of: object, change: change, context: context)
		}
	}

	////////////////////////////////////////////////////////////
	// MARK: - Private Helpers & Error Handling
	////////////////////////////////////////////////////////////

	private func getPlaybackInfo() -> (position: Int, duration: Int, track: NSDictionary?) {
		guard let player = player, let currentItem = player.currentItem else {
			return (0, 0, currentTrack)
		}
		let currentTimeSec = player.currentTime().seconds
		let durationSec = currentItem.duration.seconds
		let validCurrentTimeSec = (currentTimeSec.isNaN || currentTimeSec.isInfinite) ? 0 : currentTimeSec
		let validDurationSec = (durationSec.isNaN || durationSec.isInfinite) ? 0 : durationSec

		// Calculate position and duration in milliseconds
		let positionMs = Int(round(validCurrentTimeSec * 1000))
		let durationMs = Int(round(validDurationSec * 1000))

		// Sanitize negative values
		let sanitizedPositionMs = positionMs < 0 ? 0 : positionMs
		let sanitizedDurationMs = durationMs < 0 ? 0 : durationMs

		return (position: sanitizedPositionMs, duration: sanitizedDurationMs, track: currentTrack)
	}

	private func sendStateEvent(state: String, position: Int? = nil, duration: Int? = nil, track: NSDictionary? = nil) {
		guard hasListeners else { return }

		// When in error state, only allow ERROR or IDLE states to be emitted
		// IDLE is allowed because clear() should reset the player regardless of previous state
		if isInErrorState && state != STATE_ERROR && state != STATE_IDLE {
			log("Ignoring \(state) state after ERROR")
			return
		}

		// Filter out duplicate state emissions
		// This prevents rapid-fire transitions of the same state being emitted repeatedly
		if state == lastEmittedState {
			log("Ignoring duplicate \(state) state emission")
			return
		}

		// Use provided values or get from getPlaybackInfo() which already sanitizes values
		let info = position == nil || duration == nil ? getPlaybackInfo() : (position: position!, duration: duration!, track: track)

		let payload: [String: Any] = [
			"state": state,
			"position": info.position,
			"duration": info.duration
		]
		sendEvent(type: EVENT_TYPE_STATE_CHANGED, track: info.track ?? track, payload: payload)

		// Track the last emitted state
		lastEmittedState = state
	}

	private func sendStoppedStateEvent() {
		sendStateEvent(state: STATE_STOPPED, position: 0, duration: 0, track: currentTrack)
	}

	private func sendPlayingStateEvent() {
		sendStateEvent(state: STATE_PLAYING, track: currentTrack)
	}

	private func sendPausedStateEvent() {
		sendStateEvent(state: STATE_PAUSED, track: currentTrack)
	}

	/// Stops playback without emitting a state change event
	/// Used for error handling to avoid emitting STOPPED after ERROR
	private func stopPlaybackWithoutStateChange() {
		// Use the cleanup method with emitStateChange set to false
		cleanup(emitStateChange: false)
	}

	/// Updates Now Playing Info with specified parameters, preserving existing values
	private func updateNowPlayingInfo(time: Double? = nil, rate: Float? = nil, duration: Double? = nil, track: NSDictionary? = nil) {
		var nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()

		// Update rate if provided, otherwise use current player rate
		nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = rate ?? player?.rate ?? 0

		applyNowPlayingSeekMetadata(&nowPlayingInfo, time: time, duration: duration)

		// Ensure we have the basic track info from either provided track or current track
		let trackInfo = track ?? currentTrack
		if let trackInfo = trackInfo {
			if nowPlayingInfo[MPMediaItemPropertyTitle] == nil, let title = trackInfo["title"] as? String {
				nowPlayingInfo[MPMediaItemPropertyTitle] = title
			}
			if nowPlayingInfo[MPMediaItemPropertyArtist] == nil, let artist = trackInfo["artist"] as? String {
				nowPlayingInfo[MPMediaItemPropertyArtist] = artist
			}
			if nowPlayingInfo[MPMediaItemPropertyAlbumTitle] == nil, let album = trackInfo["album"] as? String {
				nowPlayingInfo[MPMediaItemPropertyAlbumTitle] = album
			}
		}

		MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
	}

	private func applyNowPlayingSeekMetadata(
		_ nowPlayingInfo: inout [String: Any],
		time: Double? = nil,
		duration: Double? = nil
	) {
		if let time = time {
			nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = time
		}

		if let duration = duration {
			if !duration.isNaN && !duration.isInfinite {
				nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = duration
			}
		} else if let currentItem = player?.currentItem {
			let itemDuration = currentItem.duration.seconds
			if !itemDuration.isNaN && !itemDuration.isInfinite {
				nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = itemDuration
			}
		}
	}

	private func refreshNowPlayingInfoForCurrentConfiguration() {
		let currentTime = player?.currentTime().seconds
		let validCurrentTime = currentTime?.isFinite == true ? currentTime : nil
		let duration = player?.currentItem?.duration.seconds
		let validDuration = duration?.isFinite == true ? duration : nil

		updateNowPlayingInfo(
			time: validCurrentTime,
			rate: player?.rate,
			duration: validDuration,
			track: currentTrack
		)
	}

	private func updateNowPlayingInfoWithCurrentTime(_ time: Double) {
		updateNowPlayingInfo(time: time)
	}

	/**
	 * Emits a PLAYBACK_ERROR event without transitioning to the ERROR state.
	 * Use this for non-critical errors that don't require player teardown.
	 *
	 * According to the contract in logic.md:
	 * - PLAYBACK_ERROR and ERROR state are separate and must not be conflated
	 * - PLAYBACK_ERROR can be emitted with or without a corresponding state change
	 * - Useful for soft errors (e.g., image fetch failed, headers issue, non-fatal network retry)
	 */
	func emitPlaybackError(_ errorMessage: String, code: Int = 900) {
		if hasListeners {
			let errorPayload: [String: Any] = [
				"error": errorMessage,
				"errorCode": code
			]
			sendEvent(type: EVENT_TYPE_PLAYBACK_ERROR, track: currentTrack, payload: errorPayload)
		}
	}

	/**
	 * Handles critical errors according to the contract in logic.md:
	 * - onError() should transition to ERROR state
	 * - onError() should emit STATE_CHANGED: ERROR and PLAYBACK_ERROR
	 * - onError() should clear the player state just like clear()
	 *
	 * This method is for unrecoverable player failures that require player teardown.
	 * For non-critical errors that don't require state transition, use emitPlaybackError() instead.
	 */
	func onError(_ errorMessage: String) {
		// If we're already in an error state, just log and return
		if isInErrorState {
			log("Already in error state, ignoring additional error: \(errorMessage)")
			return
		}

		if hasListeners {
			// First, emit PLAYBACK_ERROR event with error details
			let errorPayload: [String: Any] = [
				"error": errorMessage,
				"errorCode": GENERIC_ERROR_CODE
			]
			sendEvent(type: EVENT_TYPE_PLAYBACK_ERROR, track: currentTrack, payload: errorPayload)
		}

		// Then use the shared resetInternal function to:
		// 1. Clear the player state (like clear())
		// 2. Emit STATE_CHANGED: ERROR
		resetInternal(STATE_ERROR)
	}

	////////////////////////////////////////////////////////////
	// MARK: - Remote Control Commands & Magic Tap Support
	////////////////////////////////////////////////////////////

	private func applyRemoteTransportControlSettings(_ commandCenter: MPRemoteCommandCenter) {
		commandCenter.skipForwardCommand.preferredIntervals = [remoteCommandIntervalSeconds(settingSkipForwardIntervalMs)]
		commandCenter.skipBackwardCommand.preferredIntervals = [remoteCommandIntervalSeconds(settingSkipBackwardIntervalMs)]

		// Remove both controls first (reset state)
		commandCenter.nextTrackCommand.isEnabled = false
		commandCenter.previousTrackCommand.isEnabled = false
		commandCenter.skipForwardCommand.isEnabled = false
		commandCenter.skipBackwardCommand.isEnabled = false

		if settingShowNextPrevControls {
			// Enable next/prev, skip stays disabled
			commandCenter.nextTrackCommand.isEnabled = true
			commandCenter.previousTrackCommand.isEnabled = true
		} else if settingShowSkipControls {
			// Enable skip only if next/prev are NOT shown
			commandCenter.skipForwardCommand.isEnabled = true
			commandCenter.skipBackwardCommand.isEnabled = true
		}

		// Always enable play, pause, and toggle. The lock screen scrubber is configurable.
		commandCenter.playCommand.isEnabled = true
		commandCenter.pauseCommand.isEnabled = true
		commandCenter.togglePlayPauseCommand.isEnabled = true
		commandCenter.changePlaybackPositionCommand.isEnabled = !settingDisableLockScreenSeek
	}

	private func remoteCommandIntervalSeconds(_ intervalMs: Double) -> NSNumber {
		let intervalSeconds = max(1.0, intervalMs / 1000.0)
		return NSNumber(value: intervalSeconds)
	}

	private func setupRemoteTransportControls() {
		let commandCenter = MPRemoteCommandCenter.shared()

		applyRemoteTransportControlSettings(commandCenter)

		if isRemoteCommandCenterSetup { return }

		// Register command targets as before (disabling just hides/prevents UI, targets are safe to always register)
		commandCenter.skipForwardCommand.addTarget { [weak self] event in
			guard let self = self, let skipEvent = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
			self.seekForward(amount: skipEvent.interval * 1000.0)
			return .success
		}

		commandCenter.skipBackwardCommand.addTarget { [weak self] event in
			guard let self = self, let skipEvent = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
			self.seekBack(amount: skipEvent.interval * 1000.0)
			return .success
		}

		commandCenter.playCommand.addTarget { [weak self] _ in
			guard let self = self else { return .commandFailed }
			if self.player?.rate == 0 {
				self.resume()
				return .success
			}
			return .commandFailed
		}

		commandCenter.pauseCommand.addTarget { [weak self] _ in
			guard let self = self else { return .commandFailed }
			if self.player?.rate != 0 {
				self.pause()
				return .success
			}
			return .commandFailed
		}

		// Magic Tap Support: Toggle Play/Pause command
		// This enables VoiceOver Magic Tap (two-finger double-tap) functionality
		commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
			guard let self = self, let player = self.player else { return .commandFailed }

			self.log("Magic Tap (togglePlayPause) triggered")

			if player.rate > 0 {
				// Currently playing → pause
				self.pause()
				self.log("Magic Tap: Paused")
				return .success
			} else if self.currentTrack != nil {
				// Has track but paused → resume
				self.resume()
				self.log("Magic Tap: Resumed")
				return .success
			}

			return .commandFailed
		}

		commandCenter.nextTrackCommand.addTarget { [weak self] _ in
			guard let self = self else { return .commandFailed }
			self.sendEvent(type: self.EVENT_TYPE_REMOTE_NEXT, track: self.currentTrack, payload: ["state": self.lastEmittedState])
			return .success
		}

		commandCenter.previousTrackCommand.addTarget { [weak self] _ in
			guard let self = self else { return .commandFailed }
			self.sendEvent(type: self.EVENT_TYPE_REMOTE_PREV, track: self.currentTrack, payload: ["state": self.lastEmittedState])
			return .success
		}

		commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
			guard let self = self, let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
				return .commandFailed
			}
			self.seekTo(position: positionEvent.positionTime * 1000)
			if self.hasListeners {
				let positionMs = positionEvent.positionTime * 1000
				let info = self.getPlaybackInfo()
				let payload: [String: Any] = [
					"position": Int(positionMs),
					"duration": info.duration,
					"triggeredBy": self.TRIGGER_SOURCE_SYSTEM
				]
				self.sendEvent(type: self.EVENT_TYPE_SEEK_COMPLETE, track: self.currentTrack, payload: payload)
			}
			return .success
		}

		isRemoteCommandCenterSetup = true
	}

	private func removeRemoteTransportControls() {
		let commandCenter = MPRemoteCommandCenter.shared()
		commandCenter.playCommand.removeTarget(nil)
		commandCenter.pauseCommand.removeTarget(nil)
		commandCenter.togglePlayPauseCommand.removeTarget(nil) // Magic Tap cleanup
		commandCenter.nextTrackCommand.removeTarget(nil)
		commandCenter.previousTrackCommand.removeTarget(nil)
		commandCenter.changePlaybackPositionCommand.removeTarget(nil)
		commandCenter.skipForwardCommand.removeTarget(nil)
		commandCenter.skipBackwardCommand.removeTarget(nil)
	}

	////////////////////////////////////////////////////////////
	// MARK: - Ambient Audio Methods
	////////////////////////////////////////////////////////////

	/**
	 * Play an ambient audio track
	 * This is a completely isolated system from the main audio player
	 */
	@objc(ambientPlay:)
	func ambientPlay(options: NSDictionary) {
		// Get the URL from options
		guard let urlString = options["url"] as? String, let url = URL(string: urlString) else {
			onAmbientError("Invalid URL provided to ambientPlay()")
			return
		}

		// Get loop option, default to true if not provided
		settingLoopAmbient = getBool(options["loop"]) ?? true

		log("Ambient Play", urlString, "loop:", settingLoopAmbient)

		// Stop any existing ambient playback
		ambientStop()

		// Create a new player item
		ambientPlayerItem = AVPlayerItem(url: url)

		// Create a new player
		ambientPlayer = AVPlayer(playerItem: ambientPlayerItem)
		ambientPlayer?.volume = activeVolumeAmbient

		// Add observer for track completion
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(ambientPlayerItemDidPlayToEndTime(_:)),
			name: .AVPlayerItemDidPlayToEndTime,
			object: ambientPlayerItem
		)

		// Start playback immediately
		ambientPlayer?.play()
	}

	/**
	 * Stop ambient audio playback
	 */
	@objc(ambientStop)
	func ambientStop() {
		log("Ambient Stop")

		// Remove observer for track completion
		if let item = ambientPlayerItem {
			NotificationCenter.default.removeObserver(
				self,
				name: .AVPlayerItemDidPlayToEndTime,
				object: item
			)
		}

		// Stop and release the player
		ambientPlayer?.pause()
		ambientPlayer = nil
		ambientPlayerItem = nil
	}

	/**
	 * Set the volume of ambient audio playback
	 */
	@objc(ambientSetVolume:)
	func ambientSetVolume(volume: Double) {
		activeVolumeAmbient = Float(volume)
		log("Ambient Set Volume", activeVolumeAmbient)

		// Apply volume to player if it exists
		ambientPlayer?.volume = activeVolumeAmbient
	}

	/**
	 * Pause ambient audio playback
	 * No-op if already paused or not playing
	 */
	@objc(ambientPause)
	func ambientPause() {
		log("Ambient Pause")

		// Pause the player if it exists
		ambientPlayer?.pause()
	}

	/**
	 * Resume ambient audio playback
	 * No-op if already playing or no active track
	 */
	@objc(ambientResume)
	func ambientResume() {
		log("Ambient Resume")

		// Resume the player if it exists
		ambientPlayer?.play()
	}

	/**
	 * Seek to position in ambient audio track
	 * Silently ignore if not supported or no active track
	 *
	 * @param positionMs Position in milliseconds
	 */
	@objc(ambientSeekTo:)
	func ambientSeekTo(positionMs: Double) {
		log("Ambient Seek To", positionMs)

		// Convert milliseconds to seconds for CMTime
		let seconds = positionMs / 1000.0

		// Create a CMTime value for the seek position
		let time = CMTime(seconds: seconds, preferredTimescale: 1000)

		// Seek to the specified position
		ambientPlayer?.seek(to: time)
	}

	/**
	 * Handle ambient track completion
	 */
	@objc private func ambientPlayerItemDidPlayToEndTime(_ notification: Notification) {
		log("Ambient Track Ended")

		if settingLoopAmbient {
			// If looping is enabled, seek to beginning and continue playback
			ambientPlayer?.seek(to: CMTime.zero)
			ambientPlayer?.play()
		} else {
			// If looping is disabled, stop playback and emit event
			ambientStop()
			sendAmbientEvent(type: EVENT_TYPE_AMBIENT_TRACK_ENDED, payload: nil)
		}
	}

	/**
	 * Emit an ambient error event
	 */
	private func onAmbientError(_ message: String) {
		log("Ambient Error:", message)

		// Stop playback
		ambientStop()

		// Emit error event
		let payload: [String: Any] = ["error": message]
		sendAmbientEvent(type: EVENT_TYPE_AMBIENT_ERROR, payload: payload)
	}

	/**
	 * Send an ambient event to JavaScript
	 */
	private func sendAmbientEvent(type: String, payload: [String: Any]?) {
		guard hasListeners else { return }

		var body: [String: Any] = ["type": type]

		if let payload = payload {
			body["payload"] = payload
		}

		sendEvent(withName: AMBIENT_EVENT_NAME, body: body)
	}
}
