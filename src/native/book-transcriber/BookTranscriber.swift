import AVFoundation
internal import ExpoModulesCore
import Speech
import UIKit

class BookTranscriber: Module {
  private static let segmentBatchSize = 25
  private static let segmentFlushIntervalSeconds: TimeInterval = 2.0
  private static let backgroundAssertionName = "BookTranscriber.flush"

  private let sessionQueue = DispatchQueue(label: "BookTranscriber.sessions")
  private var cancelHandlers: [String: () -> Void] = [:]
  private var cancelledSessionIds: Set<String> = []

  /// Only ever touched on the main thread (UIKit's rule), so it needs no extra locking.
  private var activeBackgroundAssertions: Set<Int> = []

  func definition() -> ModuleDefinition {
    Name("BookTranscriber")

    Events(
      "onSegments",
      "onFileProgress",
      "onFileFinished",
      "onModelDownloadProgress",
      "onBackgroundTaskStart",
      "onBackgroundTaskExpire"
    )

    // The launch handler itself is registered from the AppDelegate — see
    // `BookTranscriptionBackgroundTask.swift` for why `OnCreate` is far too late for that. All this
    // does is hand the already-registered coordinator a route into JS.
    OnCreate {
      BookTranscriptionBackgroundTaskCoordinator.shared.attach(
        onStart: { [weak self] runId in
          self?.sendEvent("onBackgroundTaskStart", ["runId": runId])
        },
        onExpire: { [weak self] runId in
          self?.sendEvent("onBackgroundTaskExpire", ["runId": runId])
        }
      )
    }

    OnDestroy {
      BookTranscriptionBackgroundTaskCoordinator.shared.detach()
    }

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
        self.finishFile(taskId, reason: "failed")
        promise.reject("invalid_file", "Invalid transcription source file URL")
        return
      }

      guard FileManager.default.fileExists(atPath: sourceURL.path) else {
        self.finishFile(taskId, reason: "failed")
        promise.reject("invalid_file", "Transcription source file does not exist")
        return
      }

      // Where recognition begins, in file-relative seconds. The caller owns any rewind-for-context;
      // native never rewinds on its own. Times emitted back to JS stay file-absolute either way.
      let startSeconds = max(0, (options["startSeconds"] as? NSNumber)?.doubleValue ?? 0)

      self.startTranscription(
        taskId: taskId,
        sourceURL: sourceURL,
        localeIdentifier: options["localeIdentifier"] as? String,
        startSeconds: startSeconds,
        promise: promise
      )
    }

    AsyncFunction("cancelBookTranscription") { (taskId: String) in
      self.cancelSession(taskId)
    }

    AsyncFunction("beginBackgroundAssertion") { (promise: Promise) in
      self.beginBackgroundAssertion(promise: promise)
    }

    AsyncFunction("endBackgroundAssertion") { (identifier: Int) in
      self.endBackgroundAssertion(identifier)
    }

    // MARK: Background processing task (Phase 5)

    AsyncFunction("setBackgroundTranscriptionReady") { (ready: Bool) in
      BookTranscriptionBackgroundTaskCoordinator.shared.setReady(ready)
    }

    AsyncFunction("scheduleBackgroundTranscription") { (options: [String: Any], promise: Promise) in
      let earliestBeginSeconds = (options["earliestBeginSeconds"] as? NSNumber)?.doubleValue

      do {
        let didSchedule = try BookTranscriptionBackgroundTaskCoordinator.shared.schedule(
          earliestBeginSeconds: earliestBeginSeconds
        )
        promise.resolve(didSchedule)
      } catch {
        // Simulator, a device with Background App Refresh switched off, or an identifier missing
        // from the Info.plist. Never fatal: transcription still runs in the foreground.
        promise.reject("background_task_unavailable", error.localizedDescription)
      }
    }

    AsyncFunction("cancelBackgroundTranscription") {
      BookTranscriptionBackgroundTaskCoordinator.shared.cancelScheduled()
    }

    AsyncFunction("completeBackgroundTranscriptionRun") { (runId: String, success: Bool) in
      BookTranscriptionBackgroundTaskCoordinator.shared.complete(runId: runId, success: success)
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
    startSeconds: Double,
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
        self.finishFile(taskId, reason: "failed")
        promise.reject(
          "unavailable",
          "Speech transcription does not support locale \(requestedLocale.identifier)"
        )
        return
      }

      let installedLocales = await SpeechTranscriber.installedLocales
      guard installedLocales.contains(where: { Self.localesMatch($0, locale) }) else {
        self.endSession(taskId)
        self.finishFile(taskId, reason: "failed")
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
        self.finishFile(taskId, reason: "failed")
        promise.reject("invalid_file", "Unable to read the audio file: \(error.localizedDescription)")
        return
      }

      let durationSeconds = Self.resolveDurationSeconds(audioFile)
      guard durationSeconds > 0 else {
        self.endSession(taskId)
        self.finishFile(taskId, reason: "failed")
        promise.reject("invalid_file", "The audio file has no readable audio")
        return
      }

      let transcriber = Self.makeTranscriber(locale: locale)
      let analyzer = SpeechAnalyzer(modules: [transcriber])

      // `analyzeSequence(from:)` always ingests a file from frame 0, so a resumed file feeds the
      // analyzer its own buffers from the offset instead.
      let resumeSequence: AudioFileAnalyzerInputSequence?
      if startSeconds > 0 {
        let analysisFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
          compatibleWith: [transcriber],
          considering: audioFile.processingFormat
        )
        resumeSequence = AudioFileAnalyzerInputSequence(
          audioFile: audioFile,
          startSeconds: startSeconds,
          analysisFormat: analysisFormat ?? audioFile.processingFormat
        )
      } else {
        resumeSequence = nil
      }

      guard self.setCancelHandler(taskId, { Task { await analyzer.cancelAndFinishNow() } }) else {
        self.endSession(taskId)
        self.finishFile(taskId, reason: "cancelled")
        promise.reject("cancelled", "Book transcription was cancelled")
        return
      }

      let analysisTask = Task {
        let lastSample: CMTime?
        if let resumeSequence {
          lastSample = try await analyzer.analyzeSequence(resumeSequence)
        } else {
          lastSample = try await analyzer.analyzeSequence(from: audioFile)
        }

        if let lastSample {
          try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
          await analyzer.cancelAndFinishNow()
        }
      }

      var pendingSegments: [[String: Any]] = []
      var lastFlushAt = Date()
      var furthestEndSeconds: Double = 0

      // Never drop a batch the analyzer already produced — cancellation and hard errors alike hand
      // JS whatever was recognized before things stopped.
      func flushPending() {
        guard !pendingSegments.isEmpty else {
          return
        }

        self.flush(
          taskId: taskId,
          segments: pendingSegments,
          furthestEndSeconds: furthestEndSeconds,
          durationSeconds: durationSeconds
        )
        pendingSegments.removeAll(keepingCapacity: true)
        lastFlushAt = Date()
      }

      do {
        for try await result in transcriber.results {
          if self.isCancelled(taskId) {
            flushPending()
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
            flushPending()
          }
        }

        try await analysisTask.value
      } catch {
        flushPending()
        analysisTask.cancel()
        await analyzer.cancelAndFinishNow()
        let wasCancelled = self.endSession(taskId)
        self.finishFile(taskId, reason: wasCancelled ? "cancelled" : "failed")
        if wasCancelled {
          promise.reject("cancelled", "Book transcription was cancelled")
        } else {
          promise.reject("recognition_failed", error.localizedDescription)
        }
        return
      }

      flushPending()

      if self.endSession(taskId) {
        self.finishFile(taskId, reason: "cancelled")
        promise.reject("cancelled", "Book transcription was cancelled")
        return
      }

      self.sendEvent("onFileProgress", ["taskId": taskId, "fractionComplete": 1.0])
      self.finishFile(taskId, reason: "complete")
      promise.resolve(["durationSeconds": durationSeconds] as [String: Any])
    }
  }

  /// The last thing every `transcribeBookFile` path does before settling its promise.
  ///
  /// JS cannot tear its `onSegments` subscription down the moment that promise settles: native
  /// flushes its pending segments *before* rejecting with `cancelled`, and the event and the
  /// settlement reach JS by different routes, so the final batch can land afterwards. Before Phase 5
  /// JS covered that with a 250 ms `setTimeout` — which never fires in a background launch
  /// (`docs/carplay-debugging-log.md`, Attempt D), hanging the run forever. This marker replaces the
  /// wait with an ordering guarantee: it is emitted on the same event channel as `onSegments`, after
  /// the last flush, so seeing it means nothing more is coming.
  private func finishFile(_ taskId: String, reason: String) {
    sendEvent("onFileFinished", ["taskId": taskId, "reason": reason])
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

  // MARK: - Background assertion

  /// Wraps `UIApplication.beginBackgroundTask` so JS can keep the process alive long enough to
  /// finish a pending flush after the app is backgrounded. Nothing here touches SpeechAnalyzer, so
  /// it is deliberately not gated on iOS 26.
  private func beginBackgroundAssertion(promise: Promise) {
    DispatchQueue.main.async { [weak self] in
      // `beginBackgroundTask` only returns the identifier the handler needs *after* capturing the
      // handler, so the two meet in a box.
      let handle = BackgroundAssertionHandle()
      handle.identifier = UIApplication.shared.beginBackgroundTask(
        withName: Self.backgroundAssertionName
      ) {
        // iOS ran out of patience before JS released the assertion — end it ourselves rather than
        // be terminated for holding it.
        self?.endBackgroundAssertion(handle.identifier.rawValue)
      }

      if handle.identifier != .invalid {
        self?.activeBackgroundAssertions.insert(handle.identifier.rawValue)
      }

      promise.resolve(handle.identifier.rawValue)
    }
  }

  /// Tolerates an unknown, invalid or already-ended identifier: JS can race the expiration handler.
  private func endBackgroundAssertion(_ identifier: Int) {
    let end = { [weak self] in
      guard let self, self.activeBackgroundAssertions.remove(identifier) != nil else {
        return
      }

      UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: identifier))
    }

    if Thread.isMainThread {
      end()
    } else {
      DispatchQueue.main.async(execute: end)
    }
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

// MARK: - Background assertion handle

/// Only ever read and written on the main thread, alongside the assertion it identifies.
private final class BackgroundAssertionHandle: @unchecked Sendable {
  var identifier: UIBackgroundTaskIdentifier = .invalid
}

// MARK: - Mid-file input sequence

/// A pull-based `AnalyzerInput` sequence over an `AVAudioFile`, starting at an arbitrary offset.
///
/// `SpeechAnalyzer.analyzeSequence(from:)` always ingests a file from frame 0, so resuming a
/// partially transcribed file means feeding the analyzer ourselves. Every buffer carries an
/// explicit `bufferStartTime` measured from the start of the *file*, which is what keeps the times
/// emitted to JS file-absolute — JS has no idea a resume happened.
///
/// Buffers are read inside `next()` and never ahead of the analyzer, so a 12-hour M4B streams
/// rather than being pulled into memory.
@available(iOS 26.0, *)
private struct AudioFileAnalyzerInputSequence: AsyncSequence, Sendable {
  typealias Element = AnalyzerInput

  private let reader: AudioFileAnalyzerInputReader

  init(audioFile: AVAudioFile, startSeconds: Double, analysisFormat: AVAudioFormat) {
    reader = AudioFileAnalyzerInputReader(
      audioFile: audioFile,
      startSeconds: startSeconds,
      analysisFormat: analysisFormat
    )
  }

  func makeAsyncIterator() -> Iterator {
    Iterator(reader: reader)
  }

  struct Iterator: AsyncIteratorProtocol {
    let reader: AudioFileAnalyzerInputReader

    func next() async throws -> AnalyzerInput? {
      try reader.readNext()
    }
  }
}

/// Reads and format-converts one chunk of audio per `readNext()`.
///
/// Serialised by construction — the analyzer pulls a single buffer at a time — so the mutable read
/// cursor is never touched concurrently. Deliberately not nested inside the sequence: `AsyncSequence`
/// declares its own `min`/`max`, which would shadow the stdlib ones in a nested scope.
@available(iOS 26.0, *)
private final class AudioFileAnalyzerInputReader: @unchecked Sendable {
  private static let chunkSeconds: Double = 10

  private let audioFile: AVAudioFile
  private let readFormat: AVAudioFormat
  private let analysisFormat: AVAudioFormat
  private let converter: AVAudioConverter?
  private let startFrame: AVAudioFramePosition
  private let framesPerChunk: AVAudioFrameCount
  private let outputCapacity: AVAudioFrameCount
  private let outputTimescale: CMTimeScale

  private var nextOutputFrame: Int64
  private var didSeek = false
  private var reachedEndOfFile = false
  private var didDrainConverter = false

  init(audioFile: AVAudioFile, startSeconds: Double, analysisFormat: AVAudioFormat) {
    self.audioFile = audioFile
    self.analysisFormat = analysisFormat

    let readFormat = audioFile.processingFormat
    self.readFormat = readFormat

    let readSampleRate = readFormat.sampleRate > 0 ? readFormat.sampleRate : 1
    let outputSampleRate = analysisFormat.sampleRate > 0 ? analysisFormat.sampleRate : readSampleRate

    // Clamping past the end is not an error: the sequence then yields nothing and the file is
    // reported complete.
    let requestedFrame = AVAudioFramePosition((startSeconds * readSampleRate).rounded())
    startFrame = max(0, min(requestedFrame, audioFile.length))
    framesPerChunk = AVAudioFrameCount(max(1, (Self.chunkSeconds * readSampleRate).rounded()))

    // Rate conversion can emit a frame or two more than the ratio suggests; the headroom keeps a
    // chunk from spilling into a second `convert` call.
    outputCapacity = AVAudioFrameCount(
      (Double(framesPerChunk) * outputSampleRate / readSampleRate).rounded(.up)
    ) + 1024
    outputTimescale = CMTimeScale(outputSampleRate.rounded())

    // The analyzer measures time in the analysis format, so anchor the first buffer at the resume
    // point and let the accumulated output frame count carry it forward without drift.
    nextOutputFrame = Int64((Double(startFrame) / readSampleRate * outputSampleRate).rounded())

    if readFormat.isEqual(analysisFormat) {
      converter = nil
    } else {
      let converter = AVAudioConverter(from: readFormat, to: analysisFormat)
      // Priming would shift the output relative to the timestamps we stamp onto it.
      converter?.primeMethod = .none
      self.converter = converter
    }
  }

  func readNext() throws -> AnalyzerInput? {
    if !didSeek {
      audioFile.framePosition = startFrame
      didSeek = true
    }

    while !reachedEndOfFile {
      guard let inputBuffer = AVAudioPCMBuffer(
        pcmFormat: readFormat,
        frameCapacity: framesPerChunk
      ) else {
        reachedEndOfFile = true
        break
      }

      try audioFile.read(into: inputBuffer, frameCount: framesPerChunk)
      if inputBuffer.frameLength == 0 {
        reachedEndOfFile = true
        break
      }

      if inputBuffer.frameLength < framesPerChunk {
        reachedEndOfFile = true
      }

      if let outputBuffer = try convert(inputBuffer) {
        return input(from: outputBuffer)
      }

      // The converter had nothing to give for this chunk. If that was the last one, the loop
      // condition drops us into the drain below rather than ending the sequence early.
    }

    // The file is exhausted, but the converter may still be holding a tail. Hand it back one buffer
    // per call so the sequence ends only once it is genuinely empty. `reachedEndOfFile` stays set,
    // so this can never re-enter the file read.
    while !didDrainConverter {
      if let outputBuffer = try drainConverter() {
        return input(from: outputBuffer)
      }
    }

    return nil
  }

  /// Stamps a buffer with the running output frame count. Every buffer leaving the reader — drained
  /// ones included — goes through here, so timestamps stay continuous and file-absolute.
  private func input(from buffer: AVAudioPCMBuffer) -> AnalyzerInput {
    let bufferStartTime = CMTime(value: nextOutputFrame, timescale: outputTimescale)
    nextOutputFrame += Int64(buffer.frameLength)
    return AnalyzerInput(buffer: buffer, bufferStartTime: bufferStartTime)
  }

  private func convert(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer? {
    guard let converter else {
      return buffer
    }

    guard let outputBuffer = AVAudioPCMBuffer(
      pcmFormat: analysisFormat,
      frameCapacity: outputCapacity
    ) else {
      return nil
    }

    var consumed = false
    var conversionError: NSError?
    let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }

      consumed = true
      inputStatus.pointee = .haveData
      return buffer
    }

    if status == .error {
      throw conversionError ?? Self.conversionFailure()
    }

    // Anything the converter holds back is emitted by a later call — the next chunk's, or the drain
    // once the file runs out — timestamped from the running output frame count, so a short buffer
    // here costs nothing.
    return outputBuffer.frameLength > 0 ? outputBuffer : nil
  }

  /// Pulls whatever the converter is still holding once the file is exhausted.
  ///
  /// Sample-rate conversion keeps a short tail buffered internally; without this it would die with
  /// the reader, clipping the final word of a resumed track. Returns one buffer per call and sets
  /// `didDrainConverter` the moment there is nothing left, so the caller cannot spin on it.
  /// Yielding nothing at all is the normal case.
  private func drainConverter() throws -> AVAudioPCMBuffer? {
    guard let converter else {
      didDrainConverter = true
      return nil
    }

    guard let outputBuffer = AVAudioPCMBuffer(
      pcmFormat: analysisFormat,
      frameCapacity: outputCapacity
    ) else {
      didDrainConverter = true
      return nil
    }

    var conversionError: NSError?
    let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
      inputStatus.pointee = .endOfStream
      return nil
    }

    if status == .error {
      didDrainConverter = true
      throw conversionError ?? Self.conversionFailure()
    }

    if status == .endOfStream || outputBuffer.frameLength == 0 {
      didDrainConverter = true
    }

    return outputBuffer.frameLength > 0 ? outputBuffer : nil
  }

  private static func conversionFailure() -> NSError {
    NSError(
      domain: "BookTranscriber",
      code: -1,
      userInfo: [NSLocalizedDescriptionKey: "Unable to convert audio for analysis"]
    )
  }
}
