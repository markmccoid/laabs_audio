import AVFoundation
internal import ExpoModulesCore
import Speech

class BookTranscriber: Module {
  private static let segmentBatchSize = 25
  private static let segmentFlushIntervalSeconds: TimeInterval = 2.0

  private let sessionQueue = DispatchQueue(label: "BookTranscriber.sessions")
  private var cancelHandlers: [String: () -> Void] = [:]
  private var cancelledSessionIds: Set<String> = []

  func definition() -> ModuleDefinition {
    Name("BookTranscriber")

    Events("onSegments", "onFileProgress", "onModelDownloadProgress")

    AsyncFunction("getBookTranscriptionAvailability") { (options: [String: Any], promise: Promise) in
      guard #available(iOS 26.0, *) else {
        promise.resolve(Self.unsupportedAvailabilityPayload())
        return
      }

      self.resolveAvailability(
        localeIdentifier: options["localeIdentifier"] as? String,
        promise: promise
      )
    }

    AsyncFunction("ensureLanguageModel") { (options: [String: Any], promise: Promise) in
      guard #available(iOS 26.0, *) else {
        promise.reject("unavailable", "Book transcription requires iOS 26")
        return
      }

      self.installLanguageModel(
        localeIdentifier: options["localeIdentifier"] as? String,
        promise: promise
      )
    }

    AsyncFunction("transcribeBookFile") { (options: [String: Any], promise: Promise) in
      guard #available(iOS 26.0, *) else {
        promise.reject("unavailable", "Book transcription requires iOS 26")
        return
      }

      guard let taskId = (options["taskId"] as? String).flatMap({ $0.isEmpty ? nil : $0 }) else {
        promise.reject("invalid_file", "A taskId is required to transcribe a book file")
        return
      }

      guard let sourceFileUri = options["sourceFileUri"] as? String,
            let sourceURL = Self.resolveFileURL(sourceFileUri) else {
        promise.reject("invalid_file", "Invalid transcription source file URL")
        return
      }

      guard FileManager.default.fileExists(atPath: sourceURL.path) else {
        promise.reject("invalid_file", "Transcription source file does not exist")
        return
      }

      self.startTranscription(
        taskId: taskId,
        sourceURL: sourceURL,
        localeIdentifier: options["localeIdentifier"] as? String,
        promise: promise
      )
    }

    AsyncFunction("cancelBookTranscription") { (taskId: String) in
      self.cancelSession(taskId)
    }
  }

  // MARK: - Availability

  @available(iOS 26.0, *)
  private func resolveAvailability(localeIdentifier: String?, promise: Promise) {
    let requestedLocale = Self.resolveLocale(localeIdentifier)

    Task {
      guard SpeechTranscriber.isAvailable else {
        promise.resolve([
          "available": false,
          "reason": "unavailable",
          "localeSupported": false,
          "modelInstalled": false,
          "requestedLocaleIdentifier": requestedLocale.identifier,
        ] as [String: Any])
        return
      }

      guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        promise.resolve([
          "available": false,
          "reason": "locale_unsupported",
          "localeSupported": false,
          "modelInstalled": false,
          "requestedLocaleIdentifier": requestedLocale.identifier,
        ] as [String: Any])
        return
      }

      let installedLocales = await SpeechTranscriber.installedLocales
      let modelInstalled = installedLocales.contains(where: { Self.localesMatch($0, locale) })

      promise.resolve([
        "available": true,
        "localeSupported": true,
        "modelInstalled": modelInstalled,
        "requestedLocaleIdentifier": requestedLocale.identifier,
        "resolvedLocaleIdentifier": locale.identifier,
      ] as [String: Any])
    }
  }

  // MARK: - Language model install

  @available(iOS 26.0, *)
  private func installLanguageModel(localeIdentifier: String?, promise: Promise) {
    let requestedLocale = Self.resolveLocale(localeIdentifier)

    Task { [weak self] in
      guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        promise.reject(
          "unavailable",
          "Speech transcription does not support locale \(requestedLocale.identifier)"
        )
        return
      }

      let transcriber = Self.makeTranscriber(locale: locale)

      do {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
          // The module is not Sendable, but `sendEvent` is safe to call from any thread and the
          // observation is invalidated before this scope exits.
          nonisolated(unsafe) let module = self
          let progress = request.progress
          let observation = progress.observe(\.fractionCompleted, options: [.initial, .new]) { observed, _ in
            module?.sendEvent("onModelDownloadProgress", [
              "localeIdentifier": locale.identifier,
              "fractionComplete": observed.fractionCompleted,
            ])
          }
          defer { observation.invalidate() }
          try await request.downloadAndInstall()
        }
      } catch {
        promise.reject("model_missing", error.localizedDescription)
        return
      }

      // Best effort: reserving keeps the installed assets from being reclaimed.
      // Throws once `maximumReservedLocales` is exceeded, which is not fatal here.
      _ = try? await AssetInventory.reserve(locale: locale)

      let installedLocales = await SpeechTranscriber.installedLocales
      guard installedLocales.contains(where: { Self.localesMatch($0, locale) }) else {
        promise.reject(
          "model_missing",
          "The speech model for \(locale.identifier) could not be installed"
        )
        return
      }

      self?.sendEvent("onModelDownloadProgress", [
        "localeIdentifier": locale.identifier,
        "fractionComplete": 1.0,
      ])
      promise.resolve()
    }
  }

  // MARK: - Transcription

  @available(iOS 26.0, *)
  private func startTranscription(
    taskId: String,
    sourceURL: URL,
    localeIdentifier: String?,
    promise: Promise
  ) {
    let requestedLocale = Self.resolveLocale(localeIdentifier)
    beginSession(taskId)

    Task { [weak self] in
      guard let self else {
        return
      }

      guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        self.endSession(taskId)
        promise.reject(
          "unavailable",
          "Speech transcription does not support locale \(requestedLocale.identifier)"
        )
        return
      }

      let installedLocales = await SpeechTranscriber.installedLocales
      guard installedLocales.contains(where: { Self.localesMatch($0, locale) }) else {
        self.endSession(taskId)
        promise.reject(
          "model_missing",
          "The speech model for \(locale.identifier) is not installed"
        )
        return
      }

      let audioFile: AVAudioFile
      do {
        audioFile = try AVAudioFile(forReading: sourceURL)
      } catch {
        self.endSession(taskId)
        promise.reject("invalid_file", "Unable to read the audio file: \(error.localizedDescription)")
        return
      }

      let durationSeconds = Self.resolveDurationSeconds(audioFile)
      guard durationSeconds > 0 else {
        self.endSession(taskId)
        promise.reject("invalid_file", "The audio file has no readable audio")
        return
      }

      let transcriber = Self.makeTranscriber(locale: locale)
      let analyzer = SpeechAnalyzer(modules: [transcriber])

      guard self.setCancelHandler(taskId, { Task { await analyzer.cancelAndFinishNow() } }) else {
        self.endSession(taskId)
        promise.reject("cancelled", "Book transcription was cancelled")
        return
      }

      let analysisTask = Task {
        if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
          try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
          await analyzer.cancelAndFinishNow()
        }
      }

      var pendingSegments: [[String: Any]] = []
      var lastFlushAt = Date()
      var furthestEndSeconds: Double = 0

      do {
        for try await result in transcriber.results {
          if self.isCancelled(taskId) {
            break
          }

          // `reportingOptions` omits `.volatileResults`, so every result is already final.
          // The guard keeps that guarantee explicit.
          guard result.isFinal else {
            continue
          }

          guard let segment = Self.serializeResult(result) else {
            continue
          }

          if let endSeconds = segment["endSeconds"] as? Double {
            furthestEndSeconds = max(furthestEndSeconds, endSeconds)
          }
          pendingSegments.append(segment)

          let elapsed = Date().timeIntervalSince(lastFlushAt)
          if pendingSegments.count >= Self.segmentBatchSize
            || elapsed >= Self.segmentFlushIntervalSeconds {
            self.flush(
              taskId: taskId,
              segments: pendingSegments,
              furthestEndSeconds: furthestEndSeconds,
              durationSeconds: durationSeconds
            )
            pendingSegments.removeAll(keepingCapacity: true)
            lastFlushAt = Date()
          }
        }

        try await analysisTask.value
      } catch {
        analysisTask.cancel()
        await analyzer.cancelAndFinishNow()
        let wasCancelled = self.endSession(taskId)
        if wasCancelled {
          promise.reject("cancelled", "Book transcription was cancelled")
        } else {
          promise.reject("recognition_failed", error.localizedDescription)
        }
        return
      }

      if self.endSession(taskId) {
        promise.reject("cancelled", "Book transcription was cancelled")
        return
      }

      self.flush(
        taskId: taskId,
        segments: pendingSegments,
        furthestEndSeconds: furthestEndSeconds,
        durationSeconds: durationSeconds
      )
      self.sendEvent("onFileProgress", ["taskId": taskId, "fractionComplete": 1.0])
      promise.resolve(["durationSeconds": durationSeconds] as [String: Any])
    }
  }

  private func flush(
    taskId: String,
    segments: [[String: Any]],
    furthestEndSeconds: Double,
    durationSeconds: Double
  ) {
    guard !segments.isEmpty else {
      return
    }

    sendEvent("onSegments", ["taskId": taskId, "segments": segments])

    guard durationSeconds > 0 else {
      return
    }

    let fractionComplete = min(1.0, max(0.0, furthestEndSeconds / durationSeconds))
    sendEvent("onFileProgress", ["taskId": taskId, "fractionComplete": fractionComplete])
  }

  // MARK: - Result serialization

  @available(iOS 26.0, *)
  private static func makeTranscriber(locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [],
      attributeOptions: [.audioTimeRange]
    )
  }

  @available(iOS 26.0, *)
  private static func serializeResult(_ result: SpeechTranscriber.Result) -> [String: Any]? {
    let attributed = result.text
    let text = String(attributed.characters).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      return nil
    }

    var words: [[String: Any]] = []
    var minStartSeconds = Double.infinity
    var maxEndSeconds = -Double.infinity

    for run in attributed.runs {
      guard let timeRange = run.audioTimeRange else {
        continue
      }

      let startSeconds = timeRange.start.seconds
      let endSeconds = timeRange.end.seconds
      guard startSeconds.isFinite, endSeconds.isFinite else {
        continue
      }

      minStartSeconds = min(minStartSeconds, startSeconds)
      maxEndSeconds = max(maxEndSeconds, endSeconds)

      let runText = String(attributed[run.range].characters)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard !runText.isEmpty else {
        continue
      }

      words.append([
        "text": runText,
        "startSeconds": startSeconds,
        "endSeconds": max(startSeconds, endSeconds),
      ])
    }

    let rangeStartSeconds = result.range.start.seconds
    let rangeEndSeconds = result.range.end.seconds

    var start = minStartSeconds
    if !start.isFinite {
      start = rangeStartSeconds.isFinite ? rangeStartSeconds : 0
    }

    var end = maxEndSeconds
    if !end.isFinite {
      end = rangeEndSeconds.isFinite ? rangeEndSeconds : start
    }

    return [
      "text": text,
      "startSeconds": max(0, start),
      "endSeconds": max(max(0, start), end),
      "words": words,
    ]
  }

  @available(iOS 26.0, *)
  private static func localesMatch(_ lhs: Locale, _ rhs: Locale) -> Bool {
    lhs.identifier(.bcp47).caseInsensitiveCompare(rhs.identifier(.bcp47)) == .orderedSame
  }

  private static func resolveDurationSeconds(_ audioFile: AVAudioFile) -> Double {
    let sampleRate = audioFile.processingFormat.sampleRate > 0
      ? audioFile.processingFormat.sampleRate
      : audioFile.fileFormat.sampleRate
    guard sampleRate > 0 else {
      return 0
    }

    let seconds = Double(audioFile.length) / sampleRate
    return seconds.isFinite && seconds > 0 ? seconds : 0
  }

  // MARK: - Session bookkeeping

  private func beginSession(_ taskId: String) {
    let previousHandler: (() -> Void)? = sessionQueue.sync {
      cancelledSessionIds.remove(taskId)
      return cancelHandlers.removeValue(forKey: taskId)
    }
    previousHandler?()
  }

  private func setCancelHandler(_ taskId: String, _ handler: @escaping () -> Void) -> Bool {
    sessionQueue.sync {
      if cancelledSessionIds.contains(taskId) {
        return false
      }
      cancelHandlers[taskId] = handler
      return true
    }
  }

  private func isCancelled(_ taskId: String) -> Bool {
    sessionQueue.sync {
      cancelledSessionIds.contains(taskId)
    }
  }

  @discardableResult
  private func endSession(_ taskId: String) -> Bool {
    sessionQueue.sync {
      cancelHandlers.removeValue(forKey: taskId)
      return cancelledSessionIds.remove(taskId) != nil
    }
  }

  private func cancelSession(_ taskId: String) {
    let handler: (() -> Void)? = sessionQueue.sync {
      cancelledSessionIds.insert(taskId)
      return cancelHandlers.removeValue(forKey: taskId)
    }
    handler?()
  }

  // MARK: - Helpers

  private static func unsupportedAvailabilityPayload() -> [String: Any] {
    [
      "available": false,
      "reason": "requires_ios26",
      "localeSupported": false,
      "modelInstalled": false,
    ]
  }

  private static func resolveLocale(_ identifier: String?) -> Locale {
    if let identifier, !identifier.isEmpty {
      return Locale(identifier: identifier)
    }

    return Locale.current
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
}
