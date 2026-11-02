import Foundation
import WidgetKit
import os

/// Shared state between the LAABS Home Screen widget's play/pause intent
/// (patches/expo-widgets+58.0.20.patch) and AudioPro.
///
/// The intent runs in the app process (it is an AudioPlaybackIntent), often on a
/// cold background launch where React Native and AudioPro do not exist yet. So a
/// play request is written to UserDefaults first; AudioPro clears it when it can
/// act natively, and JS consumes it once it has loaded the last book.
///
/// An NSObject so LAABSReactRuntime (app target) can reach `trace` and
/// `markWidgetPaused` by ObjC name.
@objc(LAABSAudioWidgetBridge)
final class AudioWidgetBridge: NSObject {
	static let pendingPlayKey = "LAABSPendingWidgetPlayRequestAt"
	/// Posted by AudioPro when playback reaches the playing state, or when JS gives
	/// up on a widget play request. LAABSReactRuntime holds a background task until
	/// then, so iOS keeps a background-launched app alive until audio starts.
	static let playRequestDidEnd = Notification.Name("LAABSWidgetPlayRequestDidEnd")
	/// Posted by LAABSReactRuntime when a widget play request has not produced audio
	/// in time. JS timers do not fire in a background launch, so JS cannot time out a
	/// hung start (an unreachable server) itself; AudioPro forwards this to JS.
	static let playRequestTimedOut = Notification.Name("LAABSWidgetPlayRequestTimedOut")

	private static let widgetKind = "LAABSAudioWidget"
	private static let timelineKey = "__expo_widgets_LAABSAudioWidget_timeline"
	private static let pendingMaxAgeSeconds: TimeInterval = 60

	/// Written by the intent on every LAABS widget tap; `trace` reports time since it.
	private static let lastTapKey = "LAABSLastWidgetTapAt"
	private static let traceWindowSeconds: TimeInterval = 120
	private static let traceLog = Logger(subsystem: "laabs.widget", category: "WidgetStart")

	/// Logs a cold-start timing line, readable in Release device logs (`[WidgetStart]`;
	/// NSLog text is redacted there), only within two minutes of a widget tap so
	/// normal playback stays quiet.
	@objc static func trace(_ message: String) {
		let tappedAt = UserDefaults.standard.double(forKey: lastTapKey)
		guard tappedAt > 0 else { return }
		let elapsed = Date().timeIntervalSince1970 - tappedAt
		guard elapsed <= traceWindowSeconds else { return }
		let line = String(format: "[WidgetStart] +%.2fs %@", elapsed, message)
		traceLog.log("\(line, privacy: .public)")
	}

	static func clearPendingPlay() {
		UserDefaults.standard.removeObject(forKey: pendingPlayKey)
	}

	static var hasPendingPlay: Bool {
		UserDefaults.standard.double(forKey: pendingPlayKey) > 0
	}

	/// Returns true (and clears it) when a recent widget play request is waiting.
	static func consumePendingPlay() -> Bool {
		let defaults = UserDefaults.standard
		let requestedAt = defaults.double(forKey: pendingPlayKey)
		defaults.removeObject(forKey: pendingPlayKey)
		guard requestedAt > 0 else {
			trace("consume pending: none")
			return false
		}
		let age = Date().timeIntervalSince1970 - requestedAt
		trace(String(format: "consume pending: age %.2fs", age))
		return age <= pendingMaxAgeSeconds
	}

	/// Rewrites the widget timeline so it shows the current book as paused.
	///
	/// JS republishes the timeline while it runs, but when the process stops
	/// without JS getting a turn (terminate, a crash, a cold launch after one) the
	/// stored timeline can still claim "playing" for up to an hour.
	@objc static func markWidgetPaused() {
		guard
			let groupId = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String,
			let defaults = UserDefaults(suiteName: groupId),
			let timeline = defaults.array(forKey: timelineKey) as? [[String: Any]],
			!timeline.isEmpty
		else { return }

		let nowMs = Date().timeIntervalSince1970 * 1000
		let current = timeline.last { (($0["timestamp"] as? Double) ?? 0) <= nowMs } ?? timeline[0]
		guard
			var props = current["props"] as? [String: Any],
			var media = props["media"] as? [String: Any],
			var playback = media["playback"] as? [String: Any],
			playback["state"] as? String == "playing"
		else { return }

		playback["state"] = "paused"
		playback["anchorTimestampMs"] = nowMs
		media["playback"] = playback
		props["media"] = media
		defaults.set([["timestamp": Int(nowMs), "props": props]], forKey: timelineKey)
		WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
	}
}
