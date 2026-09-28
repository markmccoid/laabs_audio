import Foundation
import AVFoundation
import React
import MediaPlayer
import UIKit

private enum AudioWidgetPlaybackIntentNotification {
	static let name = Notification.Name("LAABSAudioWidgetPlaybackIntent")
	static let targetKey = "target"
	static let playTarget = "laabs.audio.play"
	static let pauseTarget = "laabs.audio.pause"
	static let toggleTarget = "laabs.audio.toggle"
}

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
	private let CARPLAY_EVENT_NAME = "AudioProCarPlayEvent"

	private var ambientPlayer: AVPlayer?
	private var ambientPlayerItem: AVPlayerItem?
	private var ambientProgressTimer: Timer?
	private let ambientProgressIntervalSeconds: TimeInterval = 1.0


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
	private let EVENT_TYPE_AMBIENT_PROGRESS = "AMBIENT_PROGRESS"

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
	private var lastPublishedCarPlayDefaultPlaybackRate: Float?
	// Mirrors the rate presets JS pushes via carPlaySetRates. CarPlay's
	// CPNowPlayingPlaybackRateButton only renders a real "N×" label when
	// changePlaybackRateCommand is enabled with supported rates; the default
	// list covers a cold CarPlay launch before the first JS push.
	private var carPlaySupportedPlaybackRates: [NSNumber] = [
		0.75, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0,
	]

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
    private var lastEmittedReason: String = ""
	private var wasPlayingBeforeInterruption: Bool = false
	private var pendingStartTimeMs: Double? = nil
    private let listeningWriter = DispatchQueue(label: "dev.laabs.listening-position", qos: .utility)
    private var listeningLedger: ListeningPositionLedger?
    private var listeningLease: ListeningLease?
    private var listeningContext: [String: Any]?
    private var listeningReceipt: [String: Any]?
    private var listeningTimer: Timer?
    private var periodicSavePending = false
    private var captureEnabled = false
    private var persistenceFailed = false
    private var loadId: String?
    private var loadPositionIntent = "resume"
    private var loadPositionCommandId: String?
    private var loadSerial = 0
    private var isPreparingLoad = false
    private var initialSeekPending = false
    private var pendingSeekCommand: String?
    private var interruptionActive = false
    private var transportReason = "idle"
    private var timeControlObservation: NSKeyValueObservation?
    private var itemNotificationTokens: [NSObjectProtocol] = []
    private var noMovementSince = ProcessInfo.processInfo.systemUptime
    private var lastObservedPosition: Double = 0


    // Legacy evidence is retained for diagnostics; ownerless records are never assigned to a user.
    private let interruptionResumeDefaultsKey = "AudioProInterruptionResumeRecord"
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
		return [EVENT_NAME, AMBIENT_EVENT_NAME, CARPLAY_EVENT_NAME]
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

	////////////////////////////////////////////////////////////
	// MARK: - CarPlay
	//
	// The CarPlay scene delegate (CarPlaySceneDelegate.swift) is created by
	// UIKit, not React Native, so it communicates with this emitter instance
	// via NotificationCenter. JS may also miss the CONNECTED event on a cold
	// launch from the car, so carPlayGetStatus exists for catch-up polling.
	//
	// IMPORTANT: the observers live for the module instance's lifetime
	// (init → deinit) and CarPlay events are sent WITHOUT the hasListeners
	// gate. Tying them to startObserving/stopObserving proved fragile: a
	// transient zero-listener moment (or a recycled module instance) detached
	// the observers and silently swallowed every subsequent CarPlay tap.
	////////////////////////////////////////////////////////////

	override init() {
		super.init()
		addCarPlayObservers()
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(handleAudioWidgetPlaybackIntent(_:)),
			name: AudioWidgetPlaybackIntentNotification.name,
			object: nil
		)
		// Pin the emitter's internal listener count: RCTEventEmitter.sendEvent
		// drops events entirely while the count is zero, and the count can
		// transiently hit zero (or reset on a recycled module instance) even
		// though the JS-side subscription persists. One permanent native-side
		// registration keeps the pipe open for CarPlay control events.
		addListener(CARPLAY_EVENT_NAME)
	}

    deinit {
        listeningTimer?.invalidate()
        timer?.invalidate()
        timeControlObservation = nil
        itemNotificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        removeCarPlayObservers()
		NotificationCenter.default.removeObserver(
			self,
			name: AudioWidgetPlaybackIntentNotification.name,
			object: nil
		)
	}

	@objc private func handleAudioWidgetPlaybackIntent(_ notification: Notification) {
		guard
			let target = notification.userInfo?[AudioWidgetPlaybackIntentNotification.targetKey]
				as? String,
			let player
		else {
			return
		}

		switch target {
		case AudioWidgetPlaybackIntentNotification.playTarget:
			if player.rate == 0, currentTrack != nil {
				resume()
			}
		case AudioWidgetPlaybackIntentNotification.pauseTarget:
			if player.rate != 0 {
				pause()
			}
		case AudioWidgetPlaybackIntentNotification.toggleTarget:
			if player.rate > 0 {
				pause()
			} else if currentTrack != nil {
				resume()
			}
		default:
			break
		}
	}

	private func addCarPlayObservers() {
		let center = NotificationCenter.default
		center.addObserver(
			self,
			selector: #selector(handleCarPlayConnected),
			name: CarPlayNotification.connected,
			object: nil
		)
		center.addObserver(
			self,
			selector: #selector(handleCarPlayDisconnected),
			name: CarPlayNotification.disconnected,
			object: nil
		)
		center.addObserver(
			self,
			selector: #selector(handleCarPlayItemSelected(_:)),
			name: CarPlayNotification.itemSelected,
			object: nil
		)
		center.addObserver(
			self,
			selector: #selector(handleCarPlayChapterSelected(_:)),
			name: CarPlayNotification.chapterSelected,
			object: nil
		)
		center.addObserver(
			self,
			selector: #selector(handleCarPlayRateSelected(_:)),
			name: CarPlayNotification.rateSelected,
			object: nil
		)
	}

	private func removeCarPlayObservers() {
		let center = NotificationCenter.default
		center.removeObserver(self, name: CarPlayNotification.connected, object: nil)
		center.removeObserver(self, name: CarPlayNotification.disconnected, object: nil)
		center.removeObserver(self, name: CarPlayNotification.itemSelected, object: nil)
		center.removeObserver(self, name: CarPlayNotification.chapterSelected, object: nil)
		center.removeObserver(self, name: CarPlayNotification.rateSelected, object: nil)
	}

	private func sendCarPlayEvent(_ body: [String: Any]) {
		// Deliberately not gated on hasListeners: CarPlay control events must
		// never be dropped. Worst case RN logs a "no listeners" warning.
		carPlayDebugLog("[CarPlay] emit \((body["type"] as? String) ?? "?") (hasListeners=\(hasListeners ? 1 : 0))")
		sendEvent(withName: CARPLAY_EVENT_NAME, body: body)
	}

	@objc private func handleCarPlayConnected() {
		sendCarPlayEvent(["type": "CONNECTED"])
	}

	@objc private func handleCarPlayDisconnected() {
		sendCarPlayEvent(["type": "DISCONNECTED"])
	}

	@objc private func handleCarPlayItemSelected(_ notification: Notification) {
		guard let itemId = notification.userInfo?[CarPlayNotification.itemIdKey] as? String else { return }
		sendCarPlayEvent(["type": "ITEM_SELECTED", "itemId": itemId])
	}

	@objc private func handleCarPlayChapterSelected(_ notification: Notification) {
		guard let chapterId = notification.userInfo?[CarPlayNotification.itemIdKey] as? Int else { return }
		sendCarPlayEvent(["type": "CHAPTER_SELECTED", "chapterId": chapterId])
	}

	@objc private func handleCarPlayRateSelected(_ notification: Notification) {
		guard let rate = notification.userInfo?[CarPlayNotification.itemIdKey] as? Double else { return }
		sendCarPlayEvent(["type": "RATE_SELECTED", "rate": rate])
	}

	@objc(carPlaySetShelves:)
	func carPlaySetShelves(_ shelves: NSArray) {
		CarPlayCoordinator.shared.setShelves((shelves as? [[String: Any]]) ?? [])
	}

	@objc(carPlaySetChapters:)
	func carPlaySetChapters(_ chapters: NSArray) {
		CarPlayCoordinator.shared.setChapters((chapters as? [[String: Any]]) ?? [])
	}

	@objc(carPlaySetRates:)
	func carPlaySetRates(_ rates: NSArray) {
		let parsed = (rates as? [[String: Any]]) ?? []
		let values = parsed.compactMap { $0["value"] as? NSNumber }
		if !values.isEmpty {
			carPlaySupportedPlaybackRates = values
			refreshCarPlayPlaybackRateCommand(values)
		}
		CarPlayCoordinator.shared.setRates(parsed)
	}

	@objc(carPlayLog:)
	func carPlayLog(_ message: NSString) {
		// JS-side CarPlay breadcrumbs. console.log never reaches the device
		// syslog in Release builds (RCTLog's release threshold is error), so
		// the CarPlay service mirrors its logs through this method: one
		// unified `[CarPlay]` stream in Console/idevicesyslog on hardware.
		carPlayDebugLog("[CarPlay][JS] \(message)")
	}

	@objc(carPlayShowAlert:)
	func carPlayShowAlert(_ message: NSString) {
		CarPlayCoordinator.shared.showAlert(message as String)
	}

	@objc(carPlayGetStatus:withRejecter:)
	func carPlayGetStatus(
		_ resolve: @escaping RCTPromiseResolveBlock,
		withRejecter reject: RCTPromiseRejectBlock
	) {
		resolve(["connected": CarPlayCoordinator.shared.isConnected])
	}

	private func setupAudioSessionInterruptionObserver() {
        removeAudioSessionInterruptionObserver()
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

    @objc private func handleAudioSessionInterruption(_ notification: Notification) {
        runOnMain { [weak self] in
            guard let self, let userInfo = notification.userInfo,
                  let raw = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                if !self.interruptionActive {
                    self.interruptionActive = true
                    self.wasPlayingBeforeInterruption = self.shouldBePlaying
                }
                self.transportReason = "interruption"
                self.player?.pause()
                self.captureListeningPosition(reason: "interruption")
                self.stopTimer()
                self.sendPausedStateEvent()
                self.updateNowPlayingInfo(rate: 0, playbackState: .paused)
            case .ended:
                guard self.interruptionActive else { return }
                self.interruptionActive = false
                let options = AVAudioSession.InterruptionOptions(rawValue: userInfo[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
                let resume = self.wasPlayingBeforeInterruption && self.shouldBePlaying && options.contains(.shouldResume)
                self.wasPlayingBeforeInterruption = false
                if resume { self.resume() }
                else {
                    self.shouldBePlaying = false
                    self.transportReason = "interruption-ended-paused"; self.sendPausedStateEvent()
                }
            @unknown default: break
            }
        }
    }

    // MARK: Native listening position ledger
    private func ledgerOnWriter() throws -> ListeningPositionLedger {
        if let listeningLedger { return listeningLedger }
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = base.appendingPathComponent("AudioProListeningPosition", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let path = directory.appendingPathComponent("positions.sqlite").path
        let ledger = try ListeningPositionLedger(path: path)
        for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: path + suffix) {
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: path + suffix)
        }
        listeningLedger = ledger
        return ledger
    }
    private func metadata() -> [String: Any] {
        var fields: [String: Any] = ["loadId": loadId as Any? ?? NSNull(), "initialSeekPending": initialSeekPending || pendingSeekCommand != nil,
                                   "reason": transportReason, "shouldBePlaying": shouldBePlaying,
                                   "monotonicTimeMs": ProcessInfo.processInfo.systemUptime * 1000,
                                   "positionSequence": listeningReceipt?["sequence"] ?? 0]
        if let lease = listeningLease {
            fields.merge(lease.scope.fields) { _, new in new }
            fields["playbackGeneration"] = lease.generation; fields["positionRevision"] = lease.revision
        }
        return fields
    }
    private func snapshot() -> [String: Any] {
        let info = getPlaybackInfo()
        var fields = metadata()
        fields["state"] = isInErrorState || persistenceFailed ? STATE_ERROR : initialSeekPending ? STATE_LOADING : transportReason == "stalled" ? STATE_LOADING : interruptionActive ? STATE_PAUSED : player?.timeControlStatus == .playing ? STATE_PLAYING : player?.timeControlStatus == .waitingToPlayAtSpecifiedRate ? STATE_LOADING : currentTrack == nil ? STATE_IDLE : STATE_PAUSED
        fields["position"] = info.position; fields["duration"] = info.duration
        fields["trackId"] = currentTrack?["id"] ?? NSNull()
        fields["monotonicTimeMs"] = ProcessInfo.processInfo.systemUptime * 1000
        return fields
    }
    private func savingFailed(_ error: Error, generation: Int64?) {
        guard generation == nil || listeningLease?.generation == generation else { return }
        isPreparingLoad = false
        persistenceFailed = true; shouldBePlaying = false; player?.pause()
        transportReason = "position-save-failed"; sendStateEvent(state: STATE_ERROR, track: currentTrack)
        emitPlaybackError("Unable to save listening position. Playback paused to preserve your place.", code: 901)
    }
    private func captureListeningPosition(reason: String, commandId: String? = nil,
                                          completion: ((Result<[String: Any]?, Error>) -> Void)? = nil) {
        guard captureEnabled, let lease = listeningLease, (!initialSeekPending || reason == "initial-seek-complete"), let player,
              player.currentTime().seconds.isFinite else { completion?(.success(nil)); return }
        if pendingSeekCommand != nil && reason != "initial-seek-complete" && reason != "seek-complete" {
            completion?(.success(nil)); return
        }
        if reason == "periodic" && periodicSavePending { return }
        if reason == "periodic" { periodicSavePending = true }
        let trackMs = reason == "natural-completion" && getPlaybackInfo().duration > 0
            ? Double(getPlaybackInfo().duration) : max(0, player.currentTime().seconds * 1000)
        let offset = getDouble(listeningContext?["trackStartOffsetMs"]) ?? 0
        let duration = getDouble(listeningContext?["durationMs"]) ?? Double(getPlaybackInfo().duration)
        let identity = currentTrack?["id"] as? String ?? ""
        let capturedAt = Date().timeIntervalSince1970 * 1000
        let capturedMonotonic = ProcessInfo.processInfo.systemUptime
        let finished = reason == "natural-completion" && duration > 0 && offset + trackMs >= duration - 1000
        var backgroundTask: UIBackgroundTaskIdentifier = .invalid
        if reason != "periodic" && UIApplication.shared.applicationState != .active {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Listening position") {
                if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
            }
        }
        listeningWriter.async { [weak self] in
            guard let self else { return }
            let result: Result<[String: Any]?, Error>
            do { result = .success(try self.ledgerOnWriter().commit(lease, positionMs: offset + trackMs,
                    trackPositionMs: trackMs, offsetMs: offset, trackId: identity, durationMs: duration,
                    finished: finished, reason: reason, commandId: commandId,
                    capturedAt: capturedAt, capturedMonotonic: capturedMonotonic)) }
            catch { result = .failure(error) }
            DispatchQueue.main.async {
                if reason == "periodic" { self.periodicSavePending = false }
                if backgroundTask != .invalid { UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid }
                switch result {
                case .success(let record):
                    if self.listeningLease?.generation == lease.generation && self.listeningLease?.revision == lease.revision { self.listeningReceipt = record }
                case .failure(let error):
                    if case ListeningLedgerError.stale = error {
                        if self.listeningLease?.generation == lease.generation && self.listeningLease?.revision == lease.revision &&
                           self.pendingSeekCommand == nil && !self.isPreparingLoad {
                            self.shouldBePlaying = false; self.player?.pause()
                            self.transportReason = "ownership-superseded"; self.sendPausedStateEvent()
                        }
                        break
                    }
                    self.savingFailed(error, generation: lease.generation)
                }
                completion?(result)
            }
        }
    }
    private func startListeningCapture() {
        listeningTimer?.invalidate()
        noMovementSince = ProcessInfo.processInfo.systemUptime
        lastObservedPosition = player?.currentTime().seconds ?? 0
        listeningTimer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, !self.initialSeekPending else { return }
            let position = self.player?.currentTime().seconds ?? 0
            if position.isFinite && abs(position - self.lastObservedPosition) > 0.05 {
                self.lastObservedPosition = position; self.noMovementSince = ProcessInfo.processInfo.systemUptime
            } else if self.shouldBePlaying && !self.interruptionActive && ProcessInfo.processInfo.systemUptime - self.noMovementSince >= 5 {
                self.transportReason = "stalled"
                let info = self.getPlaybackInfo()
                self.sendEvent(type: self.EVENT_TYPE_STATE_CHANGED, track: self.currentTrack,
                               payload: ["state": self.STATE_LOADING, "position": info.position, "duration": info.duration])
            }
            if self.player?.timeControlStatus == .playing { self.captureListeningPosition(reason: "periodic") }
        }
        if let listeningTimer { RunLoop.main.add(listeningTimer, forMode: .common) }
    }
    @objc(getListeningPosition:withResolver:withRejecter:)
    func getListeningPosition(_ payload: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let scope = ListeningScope(payload as? [String: Any] ?? [:]) else { reject("INVALID_SCOPE", "Listening position requires owner and playable identity", nil); return }
        listeningWriter.async { [weak self] in
            do { resolve(try self?.ledgerOnWriter().read(scope) ?? NSNull()) }
            catch { reject("POSITION_READ_FAILED", "Unable to read saved listening position", error) }
        }
    }
    @objc(getPlaybackSnapshot:withRejecter:)
    func getPlaybackSnapshot(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        runOnMain { resolve(self.snapshot()) }
    }
    @objc(checkpointListeningPosition:withResolver:withRejecter:)
    func checkpointListeningPosition(_ reason: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        runOnMain {
            self.captureListeningPosition(reason: reason) { result in
                switch result { case .success(let record): resolve(record as Any? ?? NSNull())
                case .failure(let error): reject("POSITION_SAVE_FAILED", "Listening position was not committed", error) }
            }
        }
    }
    @objc(setListeningPositionCaptureEnabled:withResolver:withRejecter:)
    func setListeningPositionCaptureEnabled(_ enabled: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        runOnMain {
            if enabled { self.captureEnabled = self.listeningLease != nil; resolve(true); return }
            self.captureListeningPosition(reason: "temporary-preview") { result in
                switch result { case .success: self.captureEnabled = false; resolve(true)
                case .failure(let error): reject("POSITION_SAVE_FAILED", "Cannot enter preview until listening position is saved", error) }
            }
        }
    }
    @objc(setListeningPosition:withResolver:withRejecter:)
    func setListeningPosition(_ payload: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let fields = payload as? [String: Any] ?? [:]
        guard let scope = ListeningScope(fields), let position = getDouble(fields["positionMs"]), position.isFinite, position >= 0 else { reject("INVALID_POSITION", "Invalid listening position", nil); return }
        runOnMain {
            let live = self.listeningLease
            if live?.scope == scope { self.player?.pause(); self.shouldBePlaying = false }
            self.listeningWriter.async {
                do {
                    let ledger = try self.ledgerOnWriter()
                    let record = try ledger.setExplicit(scope, positionMs: position,
                        durationMs: self.getDouble(fields["durationMs"]) ?? 0,
                        finished: self.getBool(fields["isFinished"]) ?? false,
                        reason: fields["reason"] as? String ?? "explicit-command",
                        commandId: fields["commandId"] as? String ?? UUID().uuidString)
                    DispatchQueue.main.async {
                        if live?.scope == scope, self.listeningLease?.generation == live?.generation {
                            if let generation = (record["playbackGeneration"] as? NSNumber)?.int64Value,
                               let revision = (record["positionRevision"] as? NSNumber)?.int64Value {
                                self.listeningLease = ListeningLease(scope: scope, generation: generation, revision: revision)
                            }
                            self.listeningReceipt = record
                            // State commands alter saved progress; old live samples must not overwrite it.
                            self.captureEnabled = false
                        }
                        resolve(record)
                    }
                } catch { reject("POSITION_SAVE_FAILED", "Listening position command was not committed", error) }
            }
        }
    }
    @objc(acknowledgeListeningPosition:withResolver:withRejecter:)
    func acknowledgeListeningPosition(_ payload: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let fields = payload as? [String: Any] ?? [:]
        guard let scope = ListeningScope(fields), let sequence = fields["sequence"] as? NSNumber, let kind = fields["kind"] as? String else { reject("INVALID_ACK", "Invalid listening position acknowledgement", nil); return }
        listeningWriter.async {
            do { resolve(try self.ledgerOnWriter().acknowledge(scope, sequence: sequence.int64Value, kind: kind) as Any? ?? NSNull()) }
            catch { reject("POSITION_ACK_FAILED", "Unable to acknowledge listening position", error) }
        }
    }
    @objc(getListeningPositionDiagnostics:withRejecter:)
    func getListeningPositionDiagnostics(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        listeningWriter.async {
            do {
                let ledger = try self.ledgerOnWriter()
                let legacy = UserDefaults.standard.dictionary(forKey: self.interruptionResumeDefaultsKey)
                let legacyIdentity = legacy?["trackId"] as? String
                let quarantine: [String: Any] = [
                    "positionMs": self.getDouble(legacy?["positionMs"]) as Any? ?? NSNull(),
                    "timestamp": self.getDouble(legacy?["timestamp"]) as Any? ?? NSNull(),
                    "trackIdentity": legacyIdentity?.contains("://") == true ? "redacted" : legacyIdentity as Any? ?? NSNull(),
                    "ownerAssociation": "unproven"
                ]
                resolve(["entries": ledger.diagnostics, "failedWrites": ledger.failedWrites, "storage": "sqlite-wal-full",
                         "legacyUnscopedEvidenceRetained": legacy != nil,
                         "legacyUnscopedEvidence": legacy != nil ? quarantine as Any : NSNull()])
            }
            catch { reject("POSITION_DIAGNOSTICS_FAILED", "Unable to open listening position diagnostics", error) }
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
			var enriched = payload
            enriched.merge(metadata()) { _, new in new }
            body["payload"] = enriched
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
			let timer = Timer(timeInterval: self.settingProgressInterval, repeats: true) { [weak self] _ in
				self?.sendProgressNoticeEvent()
			}
			self.timer = timer
			RunLoop.main.add(timer, forMode: .common)
		}
	}

	private func stopTimer() {
		DispatchQueue.main.async {
			self.timer?.invalidate()
			self.timer = nil
		}
	}

	private func sendProgressNoticeEvent() {
        guard pendingSeekCommand == nil, !initialSeekPending,
              let player = player, let _ = player.currentItem, player.rate != 0 else { return }
		let info = getPlaybackInfo()

		let payload: [String: Any] = [
			"position": info.position,
			"duration": info.duration
		]
		sendEvent(type: EVENT_TYPE_PROGRESS, track: info.track, payload: payload)

		// Keep MPNowPlayingInfoCenter truthful while playing. Consumers that
		// don't extrapolate reliably (CarPlay Now Playing, some head units)
		// otherwise show a frozen progress bar, and a stale rate makes the
		// play/pause button state wrong.
		let currentTime = player.currentTime().seconds
		if currentTime.isFinite {
			updateNowPlayingInfo(time: currentTime, rate: player.rate)
		}
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
        timeControlObservation = nil
        itemNotificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        itemNotificationTokens.removeAll()
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
        runOnMain {
            self.loadSerial += 1
            let serial = self.loadSerial
            self.isPreparingLoad = true
            // Freeze initial intent before asynchronous disk work; a later pause must win.
            self.shouldBePlaying = self.getBool(options["autoPlay"]) ?? true
            self.player?.pause()
            self.captureListeningPosition(reason: "source-switch") { result in
                if case .failure(let error) = result {
                    if case ListeningLedgerError.stale = error {} else {
                        self.savingFailed(error, generation: self.listeningLease?.generation); return
                    }
                }
                guard self.loadSerial == serial else { return }
                let context = options["listeningContext"] as? [String: Any]
                let scope = context.flatMap { ListeningScope($0) }
                let enabled = self.getBool(context?["captureEnabled"]) ?? false
                if enabled && scope == nil { self.savingFailed(ListeningLedgerError.invalid, generation: nil); return }
                self.listeningWriter.async {
                    do {
                        let lease = scope != nil ? try self.ledgerOnWriter().activate(scope!) : nil
                        let record = scope != nil ? try self.ledgerOnWriter().read(scope!) : nil
                        let preparedOptions = options.mutableCopy() as! NSMutableDictionary
                        if let scope, options["positionIntent"] as? String == "relocate",
                           let command = options["positionCommandId"] as? String,
                           let confirmed = try self.ledgerOnWriter().confirmedCommandRecord(scope, commandId: command) {
                            // Retrying an already completed rewind must resolve current evidence, not rewind twice.
                            guard confirmed["trackIdentity"] as? String == track["id"] as? String else {
                                throw ListeningLedgerError.stale
                            }
                            preparedOptions["startTimeMs"] = confirmed["trackPositionMs"]
                            preparedOptions["positionIntent"] = "resume"
                        }
                        DispatchQueue.main.async {
                            guard self.loadSerial == serial else { return }
                            self.listeningLease = lease; self.listeningReceipt = record
                            self.listeningContext = context; self.captureEnabled = enabled
                            self.persistenceFailed = false; self.interruptionActive = false
                            self.loadId = options["loadId"] as? String ?? UUID().uuidString
                            self.loadPositionIntent = preparedOptions["positionIntent"] as? String ?? "resume"
                            self.loadPositionCommandId = preparedOptions["positionCommandId"] as? String
                            self.initialSeekPending = true; self.pendingSeekCommand = nil
                            self.transportReason = "source-load"
                            self.playPrepared(track: track, options: preparedOptions)
                        }
                    } catch { DispatchQueue.main.async { self.savingFailed(error, generation: nil) } }
                }
            }
        }
    }
    private func playPrepared(track: NSDictionary, options: NSDictionary) {
        isPreparingLoad = false
		// Reset error state when playing a new track
		isInErrorState = false
		// Reset last emitted state when playing a new track
		lastEmittedState = ""
		// New session: force the next now-playing write to (re)publish the
		// CarPlay default playback rate so the rate label reflects this book,
		// not a stale value carried over from the previous one.
		lastPublishedCarPlayDefaultPlaybackRate = nil
		currentTrack = track
		settingDebug = getBool(options["debug"]) ?? false
		settingDebugIncludeProgress = getBool(options["debugIncludesProgress"]) ?? false
		let speed = Float(getDouble(options["playbackSpeed"]) ?? 1.0)
		let volume = Float(getDouble(options["volume"]) ?? 1.0)
		let autoPlay = getBool(options["autoPlay"]) ?? true
		pendingStartTimeMs = getDouble(options["startTimeMs"])

        // Resolve before choosing a file in JS. A resume may use this record only for the same file.
        if options["positionIntent"] as? String == "resume",
           listeningReceipt?["trackIdentity"] as? String == track["id"] as? String,
           let saved = getDouble(listeningReceipt?["trackPositionMs"]),
           ((listeningReceipt?["sequence"] as? NSNumber)?.int64Value ?? 0) > ((listeningReceipt?["syncedThroughSequence"] as? NSNumber)?.int64Value ?? 0),
           saved > (pendingStartTimeMs ?? 0) { pendingStartTimeMs = saved }
        pendingStartTimeMs = pendingStartTimeMs ?? 0

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
            prepareForNewPlayback()
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

				// Set up audio session interruption observer
			setupAudioSessionInterruptionObserver()
		} catch {
			onError("Audio session setup failed: \(error.localizedDescription)")
			return
		}

		sendStateEvent(state: STATE_LOADING, position: 0, duration: 0, track: currentTrack)
        // shouldBePlaying was set when this load was requested. Do not overwrite a newer pause.

		let album = track["album"] as? String
		let artist = track["artist"] as? String

		// Update now playing info without resetting the entire dictionary
		// (on main — see updateNowPlayingInfo for why).
		DispatchQueue.main.async {
			var nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
			nowPlayingInfo[MPMediaItemPropertyTitle] = title
			if let album = album {
				nowPlayingInfo[MPMediaItemPropertyAlbumTitle] = album
			}
			if let artist = artist {
				nowPlayingInfo[MPMediaItemPropertyArtist] = artist
			}
			MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
		}

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

		updateNowPlayingInfo(
			time: 0,
            rate: 0,
            duration: item.asset.duration.seconds,
            playbackState: .paused
		)

		// Add notification observer for track completion to the new item
		NotificationCenter.default.addObserver(
			self,
			selector: #selector(playerItemDidPlayToEndTime(_:)),
			name: .AVPlayerItemDidPlayToEndTime,
			object: item
		)

        // Playback begins only after initial seek completion has committed the applied position.
        player?.pause()
        observeTransport(player!, item: item)
        startListeningCapture()
        let pendingLoadSerial = loadSerial
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.loadSerial == pendingLoadSerial, self.initialSeekPending else { return }
            self.shouldBePlaying = false; self.player?.pause()
            self.transportReason = "initial-seek-timeout"
            self.sendStateEvent(state: self.STATE_ERROR, track: self.currentTrack)
            self.emitPlaybackError("Audio did not become ready; saved listening position retained")
        }
        if item.status == .readyToPlay { applyInitialSeek() }

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

	/// Run on the main thread (immediately if already there, else async).
	/// pause()/resume() bodies run through this so JS-initiated calls (RN
	/// bridge queue) take exactly the same path as CarPlay/lock-screen remote
	/// commands (main thread) — MediaRemote/CarPlay track the session state
	/// unreliably when the player is driven from a background thread.
		private func runOnMain(_ block: @escaping () -> Void) {
		if Thread.isMainThread {
			block()
			} else {
				DispatchQueue.main.async(execute: block)
			}
		}

    private func activateAudioSessionForPlayback() -> Bool {
        let otherAudioWasPlaying = AVAudioSession.sharedInstance().isOtherAudioPlaying
        let activeLoadId = loadId ?? "none"
        do {
            // A Play command is an explicit request to take audio ownership,
            // including when another app is currently playing.
            try AVAudioSession.sharedInstance().setActive(true)
            listeningWriter.async { [weak self] in
                self?.listeningLedger?.trace("audio-session-activation", [
                    "loadId": activeLoadId, "otherAudioWasPlaying": otherAudioWasPlaying,
                    "result": "success"
                ])
            }
            return true
        } catch {
            let errorCode = (error as NSError).code
            listeningWriter.async { [weak self] in
                self?.listeningLedger?.trace("audio-session-activation", [
                    "loadId": activeLoadId, "otherAudioWasPlaying": otherAudioWasPlaying,
                    "result": "failure", "errorCode": errorCode
                ])
            }
            shouldBePlaying = false
            player?.pause()
            transportReason = "activation-failed"
            sendPausedStateEvent()
            emitPlaybackError("Unable to activate audio session: \(error.localizedDescription)")
            return false
        }
    }

		@objc(pause)
	func pause() {
		runOnMain { [weak self] in
			guard let self = self else { return }
			self.shouldBePlaying = false
			self.player?.pause()
            self.transportReason = "user-pause"
            self.captureListeningPosition(reason: "pause")
			self.stopTimer()
			self.sendPausedStateEvent()
			self.updateNowPlayingInfo(
				time: self.player?.currentTime().seconds ?? 0,
				rate: 0,
				playbackState: .paused
			)
		}
	}

	@objc(resume)
	func resume() {
		runOnMain { [weak self] in
			guard let self = self else { return }
            guard !self.persistenceFailed, !self.initialSeekPending, self.pendingSeekCommand == nil, !self.interruptionActive else { return }
            self.shouldBePlaying = true
            self.transportReason = "resume-requested"
            self.noMovementSince = ProcessInfo.processInfo.systemUptime
            guard self.activateAudioSessionForPlayback() else { return }

            // Restore committed evidence if the item lost its time during a system interruption.
            if self.captureEnabled, let saved = self.getDouble(self.listeningReceipt?["trackPositionMs"]),
               self.listeningReceipt?["trackIdentity"] as? String == self.currentTrack?["id"] as? String,
               let current = self.player?.currentTime().seconds, current.isFinite,
               current * 1000 < saved - 1000 {
                self.performSeek(to: saved, intentional: false)
                return
            }
            self.player?.play()

			// play() resets the rate to the player's default (1.0); re-apply the
			// configured speed so native-initiated resumes (remote commands,
			// CarPlay) don't drop back to 1x. JS-initiated resumes re-apply speed
			// themselves, for which this is a harmless no-op.
			if self.currentPlaybackSpeed != 1.0 {
				self.player?.rate = self.currentPlaybackSpeed
			}

            // Requested play is not proof that native transport started.
            self.publishTransport()

			// Note: We don't need to call sendPlayingStateEvent() here because
			// the rate change will trigger observeValue which now calls sendPlayingStateEvent()
		}
	}

	/// stop is meant to halt playback and update the state without destroying persistent info
	/// such as artwork and remote control settings. This allows the lock screen/Control Center
	/// to continue displaying the track details for a potential resume.
    @objc func stop() {
        if !Thread.isMainThread { runOnMain { self.stop() }; return }
		// Reset error state when explicitly stopping
		isInErrorState = false
		// Reset last emitted state when stopping playback
		lastEmittedState = ""
		shouldBePlaying = false

		pendingStartTimeMs = nil

        player?.pause()
        captureListeningPosition(reason: "stop")
        // Keep the live position; a stop is not a command to reset listening progress.
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
        if !Thread.isMainThread { runOnMain { self.resetInternal(finalState) }; return }
        loadSerial += 1
        let resetSerial = loadSerial
        shouldBePlaying = false
        player?.pause()
        captureListeningPosition(reason: finalState == STATE_ERROR ? "player-error" : "teardown") { result in
            if case .failure(let error) = result { self.savingFailed(error, generation: self.listeningLease?.generation); return }
            guard self.loadSerial == resetSerial else { return }
            self.resetAfterCheckpoint(finalState)
        }
    }
    private func resetAfterCheckpoint(_ finalState: String) {
        captureEnabled = false
        isPreparingLoad = false
        initialSeekPending = false
        pendingSeekCommand = nil
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

        listeningTimer?.invalidate(); listeningTimer = nil
        timeControlObservation = nil
        itemNotificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        itemNotificationTokens.removeAll()
        // Reset pending start time
        pendingStartTimeMs = nil

		shouldBePlaying = false

		// Remove ONLY the main player's end-of-track observer. The previous
		// blanket removeObserver(self) also tore down the CarPlay
		// NotificationCenter observers registered in init — cleanup() runs on
		// every book switch (clear() → resetInternal), so after the FIRST
		// switch every CarPlay tap/rate pick posted to a dead observer and was
		// silently dropped ("stuck on current book", hardware 2026-07-03). It
		// also killed the ambient player's end-of-track observer.
		if let currentItem = player?.currentItem {
			NotificationCenter.default.removeObserver(
				self,
				name: .AVPlayerItemDidPlayToEndTime,
				object: currentItem
			)
		}

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
    private func performSeek(to position: Double, isAbsolute: Bool = true, intentional: Bool = true) {
        runOnMain {
            guard let player = self.player, let item = player.currentItem else { self.emitPlaybackError("Cannot seek: no item loaded"); return }
            let duration = item.duration.seconds
            let current = player.currentTime().seconds
            guard position.isFinite, duration.isFinite, current.isFinite else { self.emitPlaybackError("Cannot seek: invalid timing"); return }
            let target = max(0, min(isAbsolute ? position / 1000 : current + position / 1000, duration))
            let command = self.initialSeekPending ? (self.loadPositionCommandId ?? UUID().uuidString) : UUID().uuidString
            let serial = self.loadSerial
            let lease = self.captureEnabled && intentional ? self.listeningLease : nil
            self.pendingSeekCommand = command
            self.stopTimer()
            let execute: (ListeningLease?) -> Void = { next in
                guard self.loadSerial == serial, self.pendingSeekCommand == command else { return }
                if let next { self.listeningLease = next }
                item.cancelPendingSeeks()
                player.seek(to: CMTime(seconds: target, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { completed in
                    self.runOnMain {
                        guard self.player === player, self.loadSerial == serial, self.pendingSeekCommand == command else { return }
                        guard completed, player.currentTime().seconds.isFinite, abs(player.currentTime().seconds - target) <= 0.1 else {
                            self.player?.pause(); self.shouldBePlaying = false
                            self.transportReason = "seek-failed"; self.sendStateEvent(state: self.STATE_ERROR, track: self.currentTrack)
                            self.emitPlaybackError("Audio seek did not complete; saved listening position retained"); return
                        }
                        let wasInitialSeek = self.initialSeekPending
                        self.captureListeningPosition(reason: wasInitialSeek ? "initial-seek-complete" : "seek-complete", commandId: intentional ? command : nil) { result in
                            guard self.loadSerial == serial, self.pendingSeekCommand == command else { return }
                            if case .failure = result { return }
                            self.initialSeekPending = false
                            self.pendingSeekCommand = nil
                            self.transportReason = "seek-complete"
                            self.completeSeekingAndSendSeekCompleteNoticeEvent(newPosition: player.currentTime().seconds * 1000)
                            if self.shouldBePlaying && !self.interruptionActive && !self.persistenceFailed {
                                guard self.activateAudioSessionForPlayback() else { return }
                                player.playImmediately(atRate: self.currentPlaybackSpeed)
                                self.noMovementSince = ProcessInfo.processInfo.systemUptime
                            }
                            self.publishTransport()
                        }
                    }
                }
            }
            if let lease {
                self.listeningWriter.async {
                    do {
                        let next = try self.ledgerOnWriter().beginRelocation(lease, target: (self.getDouble(self.listeningContext?["trackStartOffsetMs"]) ?? 0) + target * 1000, commandId: command)
                        DispatchQueue.main.async { execute(next) }
                    } catch { DispatchQueue.main.async { self.savingFailed(error, generation: lease.generation) } }
                }
            } else { execute(nil) }
        }
    }
    private func applyInitialSeek() {
        guard initialSeekPending, pendingSeekCommand == nil, let target = pendingStartTimeMs,
              let player, player.currentItem?.status == .readyToPlay else { return }
        pendingStartTimeMs = nil
        performSeek(to: target, intentional: loadPositionIntent == "relocate")
    }
    private func observeTransport(_ observed: AVPlayer, item: AVPlayerItem) {
        timeControlObservation = observed.observe(\.timeControlStatus, options: [.new]) { [weak self, weak observed] _, _ in
            self?.runOnMain { [weak self, weak observed] in
                guard let self, let observed, self.player === observed else { return }
                self.publishTransport()
            }
        }
        let center = NotificationCenter.default
        itemNotificationTokens.append(center.addObserver(forName: .AVPlayerItemPlaybackStalled, object: item, queue: .main) { [weak self] _ in
            guard let self, self.player?.currentItem === item else { return }
            self.transportReason = "stalled"; self.captureListeningPosition(reason: "stalled")
            self.sendStateEvent(state: self.STATE_LOADING, track: self.currentTrack)
        })
        itemNotificationTokens.append(center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            guard let self, self.player?.currentItem === item else { return }
            self.transportReason = "item-failed"; self.onError("The audio stream failed")
        })
        itemNotificationTokens.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notice in
            guard let self else { return }
            self.captureListeningPosition(reason: "route-change")
            if (notice.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { self.pause() }
        })
        itemNotificationTokens.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.transportReason = "media-services-reset"; self?.onError("Audio services were reset")
        })
    }
    private func publishTransport() {
        guard !initialSeekPending, !isInErrorState, !persistenceFailed, let player else { return }
        let state = interruptionActive ? STATE_PAUSED : player.timeControlStatus == .playing ? STATE_PLAYING : player.timeControlStatus == .waitingToPlayAtSpecifiedRate ? STATE_LOADING : STATE_PAUSED
        transportReason = interruptionActive ? "interruption" : state == STATE_LOADING ? "buffering" : state == STATE_PLAYING ? "transport-playing" : "transport-paused"
        let diagnostic = snapshot()
        listeningWriter.async { [weak self] in self?.listeningLedger?.trace("transport", diagnostic) }
        sendStateEvent(state: state, track: currentTrack)
        updateNowPlayingInfo(rate: state == STATE_PLAYING ? player.rate : 0, playbackState: state == STATE_PLAYING ? .playing : .paused)
        if state == STATE_PLAYING { startProgressTimer() } else { stopTimer() }
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
        if !Thread.isMainThread { runOnMain { self.setPlaybackSpeed(speed: speed) }; return }
		currentPlaybackSpeed = Float(speed)

		guard let player = player else {
			onError("Cannot set playback speed: no track is playing")
			return
		}

		log("Setting playback speed to ", speed)
		// Only drive the live rate when already playing: assigning a non-zero
		// rate to AVPlayer STARTS playback, so doing it while paused silently
		// un-paused tracks (e.g. right after a load with autoPlay:false).
		// While paused, the speed is recorded above and applied by resume().
		let isPlaying = player.rate != 0
		if isPlaying {
			player.rate = Float(speed)
		}

		// Momentary rate stays 0 while paused; the user-chosen speed reaches
		// consumers via MPNowPlayingInfoPropertyDefaultPlaybackRate.
		updateNowPlayingInfo(rate: isPlaying ? Float(speed) : 0, playbackState: isPlaying ? .playing : .paused)
		// A paused now-playing metadata write does not reliably repaint
		// CPNowPlayingPlaybackRateButton; refreshing the command state nudges
		// CarPlay without setting AVPlayer.rate and accidentally resuming audio.
		refreshCarPlayPlaybackRateCommand()

		if hasListeners {
			let playbackInfo = getPlaybackInfo()
			let payload: [String: Any] = ["speed": speed]
			sendEvent(type: EVENT_TYPE_PLAYBACK_SPEED_CHANGED, track: playbackInfo.track, payload: payload)
		}
	}

	@objc(setVolume:)
    func setVolume(volume: Double) {
        if !Thread.isMainThread { runOnMain { self.setVolume(volume: volume) }; return }
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
        guard let ended = notification.object as? AVPlayerItem, ended === player?.currentItem else { return }

		if isInErrorState {
			log("Ignoring track end notification while in ERROR state")
			return
		}

        let info = getPlaybackInfo()
        transportReason = "natural-completion"
        captureListeningPosition(reason: "natural-completion")
        isInErrorState = false
		lastEmittedState = ""
		shouldBePlaying = false

        player?.pause()
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
            if let item = object as? AVPlayerItem, item === player?.currentItem {
				switch item.status {
				case .readyToPlay:
					log("Player item ready to play")
                    applyInitialSeek()
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
            if let observed = object as? AVPlayer, observed === player { publishTransport() }
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
        if state == lastEmittedState && transportReason == lastEmittedReason {
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
        lastEmittedReason = transportReason
	}

	private func sendStoppedStateEvent() {
		sendStateEvent(state: STATE_STOPPED, position: 0, duration: 0, track: currentTrack)
	}

	private func sendPlayingStateEvent() {
        guard player?.timeControlStatus == .playing, !initialSeekPending, !interruptionActive else { return }
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

	/// Updates Now Playing Info with specified parameters, preserving existing values.
	/// Always writes on the main thread: MPNowPlayingInfoCenter writes from a
	/// background thread (the RN bridge queue, for JS-initiated pause/resume)
	/// intermittently fail to propagate to external observers — lock screen and
	/// especially CarPlay — while main-thread writes (remote-command handlers,
	/// the progress timer) do. Values are captured before hopping threads.
	private func updateNowPlayingInfo(
		time: Double? = nil,
		rate: Float? = nil,
		duration: Double? = nil,
		track: NSDictionary? = nil,
		playbackState: MPNowPlayingPlaybackState? = nil
	) {
		let resolvedRate = rate ?? player?.rate ?? 0
		if !Thread.isMainThread {
			DispatchQueue.main.async { [weak self] in
				self?.updateNowPlayingInfoOnMain(
					time: time,
					rate: resolvedRate,
					duration: duration,
					track: track,
					playbackState: playbackState
				)
			}
			return
		}
		updateNowPlayingInfoOnMain(
			time: time,
			rate: resolvedRate,
			duration: duration,
			track: track,
			playbackState: playbackState
		)
	}

	private func updateNowPlayingInfoOnMain(
		time: Double?,
		rate: Float,
		duration: Double?,
		track: NSDictionary?,
		playbackState: MPNowPlayingPlaybackState?
	) {
		var nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
		let previousDefaultRate = lastPublishedCarPlayDefaultPlaybackRate

		nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = rate
		// The user-chosen speed, independent of the momentary rate (which is 0
		// while paused). CarPlay's CPNowPlayingPlaybackRateButton renders THIS
		// key as its label — without it the button reads "0x" forever.
		nowPlayingInfo[MPNowPlayingInfoPropertyDefaultPlaybackRate] = currentPlaybackSpeed
		if previousDefaultRate == nil || abs((previousDefaultRate ?? 0) - currentPlaybackSpeed) > 0.0001 {
			lastPublishedCarPlayDefaultPlaybackRate = currentPlaybackSpeed
			carPlayDebugLog(String(format: "[CarPlay] nowPlaying rates playback=%.2f default=%.2f", rate, currentPlaybackSpeed))
		}

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

		let center = MPNowPlayingInfoCenter.default()
		center.nowPlayingInfo = nowPlayingInfo
		if let playbackState = playbackState {
			center.playbackState = playbackState
		}
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
        if !Thread.isMainThread { runOnMain { self.onError(errorMessage) }; return }
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

		// CarPlay's CPNowPlayingPlaybackRateButton derives its "N×" label from
		// this command's state; with it disabled the label renders "0×" even
		// when MPNowPlayingInfoPropertyDefaultPlaybackRate is correct.
		commandCenter.changePlaybackRateCommand.isEnabled = true
		commandCenter.changePlaybackRateCommand.supportedPlaybackRates = carPlaySupportedPlaybackRates
	}

	private func refreshCarPlayPlaybackRateCommand(_ rates: [NSNumber]? = nil) {
		let supportedRates = rates ?? carPlaySupportedPlaybackRates
		DispatchQueue.main.async {
			let command = MPRemoteCommandCenter.shared().changePlaybackRateCommand
			command.isEnabled = true
			command.supportedPlaybackRates = supportedRates
		}
	}

	private func remoteCommandIntervalSeconds(_ intervalMs: Double) -> NSNumber {
		let intervalSeconds = max(1.0, intervalMs / 1000.0)
		return NSNumber(value: intervalSeconds)
	}

	private func setupRemoteTransportControls() {
		let commandCenter = MPRemoteCommandCenter.shared()

		applyRemoteTransportControlSettings(commandCenter)

		if isRemoteCommandCenterSetup { return }

		// Register with MediaRemote so external now-playing consumers
		// (CarPlay in particular) associate this app with the session.
		DispatchQueue.main.async {
			UIApplication.shared.beginReceivingRemoteControlEvents()
		}

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

		// Play/pause are idempotent: if the requested state already holds,
		// report success instead of .commandFailed. A consumer with a stale
		// button state (e.g. CarPlay Now Playing) otherwise gets a dead button —
		// its tap routes to the "wrong" command, which then refuses to act.
		commandCenter.playCommand.addTarget { [weak self] _ in
			guard let self = self, self.player != nil else { return .commandFailed }
			if self.player?.rate == 0 {
				self.resume()
			}
			return .success
		}

		commandCenter.pauseCommand.addTarget { [weak self] _ in
			guard let self = self, self.player != nil else { return .commandFailed }
			if self.player?.rate != 0 {
				self.pause()
			}
			return .success
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

		// System-initiated rate changes (Siri, CarPlay rate cycling). Route
		// through the same notification pipeline as the CarPlay rate picker so
		// JS applies the rate and persists the per-book preference.
		commandCenter.changePlaybackRateCommand.addTarget { event in
			guard let rateEvent = event as? MPChangePlaybackRateCommandEvent else {
				return .commandFailed
			}
			carPlayDebugLog(String(format: "[CarPlay] changePlaybackRateCommand fired rate=%.2f", rateEvent.playbackRate))
			NotificationCenter.default.post(
				name: CarPlayNotification.rateSelected,
				object: nil,
				userInfo: [CarPlayNotification.itemIdKey: Double(rateEvent.playbackRate)]
			)
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
		commandCenter.changePlaybackRateCommand.removeTarget(nil)
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
		startAmbientProgressTimer()
	}

	/**
	 * Stop ambient audio playback
	 */
	@objc(ambientStop)
	func ambientStop() {
		log("Ambient Stop")

		stopAmbientProgressTimer()

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

		// Emit the paused position before the ticker stops so JS records the
		// exact place we stopped rather than extrapolating past it.
		sendAmbientProgressEvent(force: true)
		stopAmbientProgressTimer()
	}

	/**
	 * Resume ambient audio playback
	 * No-op if already playing or no active track
	 */
	@objc(ambientResume)
	func ambientResume() {
		log("Ambient Resume")

		// Resume the player if it exists
		guard let ambientPlayer = ambientPlayer else { return }
		ambientPlayer.play()
		startAmbientProgressTimer()
	}

	/**
	 * Seek to position in ambient audio track
	 * Silently ignore if not supported or no active track
	 *
	 * @param positionMs Position in milliseconds
	 */
	@objc(ambientSeekTo:)
	func ambientSeekTo(positionMs: Double) {
		guard let ambientPlayer = ambientPlayer else { return }

		// A resume position saved across loops can exceed the file length, and
		// seeking past the end lands on the last frame (which immediately fires
		// end-of-item). Wrap it into the track instead. Duration is 0 until the
		// item is ready, in which case the caller's value is used as-is.
		var targetMs = max(0, positionMs)
		let durationMs = ambientDurationMs()
		if durationMs > 0, targetMs >= durationMs {
			targetMs = targetMs.truncatingRemainder(dividingBy: durationMs)
		}

		log("Ambient Seek To", positionMs, "resolved:", targetMs)

		let time = CMTime(seconds: targetMs / 1000.0, preferredTimescale: 1000)
		ambientPlayer.seek(to: time) { [weak self] _ in
			self?.sendAmbientProgressEvent(force: true)
		}
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

			// Report the wrap right away so JS does not keep extrapolating past
			// the end of the file until the next tick.
			sendAmbientProgressEvent(force: true)
		} else {
			// If looping is disabled, stop playback and emit event
			ambientStop()
			sendAmbientEvent(type: EVENT_TYPE_AMBIENT_TRACK_ENDED, payload: nil)
		}
	}

	/**
	 * Duration of the loaded ambient item in milliseconds, or 0 while unknown
	 * (the item reports NaN/indefinite until it is ready to play).
	 */
	private func ambientDurationMs() -> Double {
		guard let item = ambientPlayerItem else { return 0 }
		let seconds = item.duration.seconds
		guard seconds.isFinite, seconds > 0 else { return 0 }
		return seconds * 1000
	}

	/**
	 * Emit the ambient player's real position and duration.
	 *
	 * Ambient audio has no state tracking, so JS previously had to estimate the
	 * position from a wall clock — which never wrapped at the end of a looping
	 * file and drifted whenever the player was not actually advancing.
	 *
	 * @param force Emit even when the player is not currently playing (used for
	 *              pause and seek, where the resting position is what matters).
	 */
	private func sendAmbientProgressEvent(force: Bool = false) {
		guard let player = ambientPlayer else { return }
		guard force || player.rate != 0 else { return }

		let positionSeconds = player.currentTime().seconds
		let positionMs = positionSeconds.isFinite ? max(0, positionSeconds * 1000) : 0

		let payload: [String: Any] = [
			"position": positionMs,
			"duration": ambientDurationMs()
		]
		sendAmbientEvent(type: EVENT_TYPE_AMBIENT_PROGRESS, payload: payload)
	}

	private func startAmbientProgressTimer() {
		DispatchQueue.main.async {
			self.ambientProgressTimer?.invalidate()
			self.sendAmbientProgressEvent(force: true)
			let timer = Timer(timeInterval: self.ambientProgressIntervalSeconds, repeats: true) {
				[weak self] _ in
				self?.sendAmbientProgressEvent()
			}
			self.ambientProgressTimer = timer
			RunLoop.main.add(timer, forMode: .common)
		}
	}

	private func stopAmbientProgressTimer() {
		DispatchQueue.main.async {
			self.ambientProgressTimer?.invalidate()
			self.ambientProgressTimer = nil
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
			var enriched = payload
            enriched.merge(metadata()) { _, new in new }
            body["payload"] = enriched
		}

		sendEvent(withName: AMBIENT_EVENT_NAME, body: body)
	}
}
