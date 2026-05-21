import AVFoundation
import ExpoModulesCore
import Speech

public class ClipTranscriberModule: Module {
  private let sessionQueue = DispatchQueue(label: "ClipTranscriber.sessions")
  private var sessions: [String: SFSpeechRecognitionTask] = [:]
  private var requests: [String: SFSpeechURLRecognitionRequest] = [:]
  private var cancelledSessionIds: Set<String> = []

  private enum RecognitionMode {
    case automatic
    case onDevice
  }

  public func definition() -> ModuleDefinition {
    Name("ClipTranscriber")

    AsyncFunction("getClipTranscriptionAvailability") { (options: [String: Any], promise: Promise) in
      let localeIdentifier = options["localeIdentifier"] as? String
      guard let recognizer = Self.makeRecognizer(localeIdentifier: localeIdentifier) else {
        promise.resolve([
          "available": false,
          "reason": "Speech recognition is unavailable for this locale",
        ])
        return
      }

      let authorizationStatus = SFSpeechRecognizer.authorizationStatus()
      let isAuthorized =
        authorizationStatus == .authorized || authorizationStatus == .notDetermined
      var availability: [String: Any] = [
        "available": recognizer.isAvailable && isAuthorized,
        "provider": "apple-speech",
        "supportsOnDeviceRecognition": recognizer.supportsOnDeviceRecognition,
      ]
      if let reason = Self.availabilityReason(
        recognizer: recognizer,
        authorizationStatus: authorizationStatus
      ) {
        availability["reason"] = reason
      }
      promise.resolve(availability)
    }

    AsyncFunction("transcribeClip") { (options: [String: Any], promise: Promise) in
      guard let sourceFileUri = options["sourceFileUri"] as? String,
            let sourceURL = Self.resolveFileURL(sourceFileUri) else {
        promise.reject("invalid_range", "Invalid transcription source file URL")
        return
      }

      guard FileManager.default.fileExists(atPath: sourceURL.path) else {
        promise.reject("invalid_range", "Transcription source file does not exist")
        return
      }

      let sourceDurationSeconds = Self.resolveDurationSeconds(sourceURL)
      guard sourceDurationSeconds > 0 else {
        promise.reject("invalid_range", "Transcription source file has no readable audio")
        return
      }

      let localeIdentifier = options["localeIdentifier"] as? String
      guard let recognizer = Self.makeRecognizer(localeIdentifier: localeIdentifier) else {
        promise.reject("unavailable", "Speech recognition is unavailable for this locale")
        return
      }

      let taskId = (options["taskId"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? UUID().uuidString
      Self.requestAuthorization { status in
        guard status == .authorized else {
          promise.reject("permission_denied", "Speech recognition permission was denied")
          return
        }

        guard recognizer.isAvailable else {
          promise.reject("unavailable", "Speech recognition is unavailable")
          return
        }

        self.startRecognition(
          recognizer: recognizer,
          sourceURL: sourceURL,
          taskId: taskId,
          promise: promise
        )
      }
    }

    AsyncFunction("cancelClipTranscription") { (taskId: String) in
      self.sessionQueue.sync {
        self.cancelledSessionIds.insert(taskId)
        self.sessions.removeValue(forKey: taskId)?.cancel()
      }
    }
  }

  private static func requestAuthorization(completion: @escaping (SFSpeechRecognizerAuthorizationStatus) -> Void) {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status != .notDetermined {
      completion(status)
      return
    }

    SFSpeechRecognizer.requestAuthorization { nextStatus in
      DispatchQueue.main.async {
        completion(nextStatus)
      }
    }
  }

  private func startRecognition(
    recognizer: SFSpeechRecognizer,
    sourceURL: URL,
    taskId: String,
    promise: Promise
  ) {
    let modes = Self.recognitionModes(for: recognizer)
    startRecognitionAttempt(
      recognizer: recognizer,
      sourceURL: sourceURL,
      sourceDurationSeconds: Self.resolveDurationSeconds(sourceURL),
      taskId: taskId,
      remainingModes: modes,
      promise: promise
    )
  }

  private func startRecognitionAttempt(
    recognizer: SFSpeechRecognizer,
    sourceURL: URL,
    sourceDurationSeconds: Double,
    taskId: String,
    remainingModes: [RecognitionMode],
    promise: Promise
  ) {
    guard let mode = remainingModes.first else {
      promise.reject("recognition_failed", "Speech recognition failed")
      return
    }

    let request = Self.makeRecognitionRequest(sourceURL: sourceURL, mode: mode)
    let fallbackModes = Array(remainingModes.dropFirst())

    var didFinish = false
    let task = recognizer.recognitionTask(with: request) { result, error in
      if didFinish {
        return
      }

      if let error = error {
        didFinish = true
        let wasCancelled = self.removeSession(taskId)
        if wasCancelled {
          promise.reject("cancelled", "Clip Transcription was cancelled")
        } else if !fallbackModes.isEmpty {
          self.startRecognitionAttempt(
            recognizer: recognizer,
            sourceURL: sourceURL,
            sourceDurationSeconds: sourceDurationSeconds,
            taskId: taskId,
            remainingModes: fallbackModes,
            promise: promise
          )
        } else {
          promise.reject("recognition_failed", error.localizedDescription)
        }
        return
      }

      guard let result = result, result.isFinal else {
        return
      }

      didFinish = true
      self.removeSession(taskId)
      promise.resolve(Self.serializeResult(
        result: result,
        recognizer: recognizer,
        sourceDurationSeconds: sourceDurationSeconds
      ))
    }

    sessionQueue.sync {
      sessions[taskId]?.cancel()
      requests[taskId] = request
      sessions[taskId] = task
    }
  }

  private func removeSession(_ taskId: String) -> Bool {
    sessionQueue.sync {
      sessions.removeValue(forKey: taskId)
      requests.removeValue(forKey: taskId)
      return cancelledSessionIds.remove(taskId) != nil
    }
  }

  private static func recognitionModes(for recognizer: SFSpeechRecognizer) -> [RecognitionMode] {
    if #available(iOS 13.0, *), recognizer.supportsOnDeviceRecognition {
      return [.automatic, .onDevice]
    }

    return [.automatic]
  }

  private static func makeRecognitionRequest(
    sourceURL: URL,
    mode: RecognitionMode
  ) -> SFSpeechURLRecognitionRequest {
    let request = SFSpeechURLRecognitionRequest(url: sourceURL)
    request.shouldReportPartialResults = false

    if #available(iOS 13.0, *) {
      request.requiresOnDeviceRecognition = mode == .onDevice
    }

    return request
  }

  private static func makeRecognizer(localeIdentifier: String?) -> SFSpeechRecognizer? {
    if let localeIdentifier, !localeIdentifier.isEmpty {
      return SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier))
    }

    return SFSpeechRecognizer()
  }

  private static func availabilityReason(
    recognizer: SFSpeechRecognizer,
    authorizationStatus: SFSpeechRecognizerAuthorizationStatus
  ) -> String? {
    switch authorizationStatus {
    case .denied, .restricted:
      return "Speech recognition permission was denied"
    default:
      break
    }

    if !recognizer.isAvailable {
      return "Speech recognition is unavailable"
    }

    return nil
  }

  private static func resolveFileURL(_ value: String) -> URL? {
    if value.hasPrefix("file://") {
      if let url = URL(string: value) {
        return url
      }

      let path = String(value.dropFirst("file://".count)).removingPercentEncoding ?? String(value.dropFirst("file://".count))
      return URL(fileURLWithPath: path)
    }

    if value.hasPrefix("/") {
      return URL(fileURLWithPath: value)
    }

    return URL(string: value)
  }

  private static func serializeResult(
    result: SFSpeechRecognitionResult,
    recognizer: SFSpeechRecognizer,
    sourceDurationSeconds: Double
  ) -> [String: Any] {
    let transcription = result.bestTranscription
    let segments = transcription.segments.map { segment in
      [
        "text": segment.substring,
        "startSeconds": segment.timestamp,
        "durationSeconds": segment.duration,
        "confidence": segment.confidence,
      ] as [String: Any]
    }

    return [
      "text": transcription.formattedString,
      "provider": "apple-speech",
      "localeIdentifier": recognizer.locale.identifier,
      "durationSeconds": sourceDurationSeconds,
      "segments": segments,
      "isFinal": true,
    ]
  }

  private static func resolveDurationSeconds(_ sourceURL: URL) -> Double {
    let asset = AVAsset(url: sourceURL)
    let seconds = CMTimeGetSeconds(asset.duration)
    return seconds.isFinite && seconds > 0 ? seconds : 0
  }
}
