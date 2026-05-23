internal import ExpoModulesCore
import AVFoundation

class AudioTrimmer: Module {
  private static let fallbackAacBitRate = 64_000

  func definition() -> ModuleDefinition {
    Name("AudioTrimmer")

    AsyncFunction("trimAudio") { (fileUrl: String, startTime: Double, endTime: Double, promise: Promise) in
      guard let sourceURL = Self.resolveFileURL(fileUrl) else {
        promise.reject("ERR_URL", "Invalid file URL provided")
        return
      }

      guard startTime.isFinite, endTime.isFinite, endTime > startTime else {
        promise.reject("ERR_RANGE", "Invalid trim range")
        return
      }

      let asset = AVAsset(url: sourceURL)
      let start = CMTime(seconds: startTime, preferredTimescale: 1000)
      let end = CMTime(seconds: endTime, preferredTimescale: 1000)
      let timeRange = CMTimeRange(start: start, end: end)
      let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")

      Self.export(
        asset: asset,
        outputURL: outputURL,
        outputFileType: .m4a,
        timeRange: timeRange,
        presets: [AVAssetExportPresetPassthrough],
        promise: promise
      )
    }
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

  private static func makeExportSession(
    asset: AVAsset,
    presetName: String,
    outputFileType: AVFileType
  ) -> AVAssetExportSession? {
    guard let session = AVAssetExportSession(
      asset: asset,
      presetName: presetName
    ), session.supportedFileTypes.contains(outputFileType) else {
      return nil
    }

    return session
  }

  private static func export(
    asset: AVAsset,
    outputURL: URL,
    outputFileType: AVFileType,
    timeRange: CMTimeRange,
    presets: [String],
    promise: Promise,
    lastError: Error? = nil
  ) {
    guard let presetName = presets.first else {
      transcodeLowBitrateAac(
        asset: asset,
        outputURL: outputURL,
        timeRange: timeRange,
        promise: promise,
        passthroughError: lastError
      )
      return
    }

    guard let exportSession = makeExportSession(
      asset: asset,
      presetName: presetName,
      outputFileType: outputFileType
    ) else {
      export(
        asset: asset,
        outputURL: outputURL,
        outputFileType: outputFileType,
        timeRange: timeRange,
        presets: Array(presets.dropFirst()),
        promise: promise,
        lastError: lastError
      )
      return
    }

    try? FileManager.default.removeItem(at: outputURL)
    exportSession.outputURL = outputURL
    exportSession.outputFileType = outputFileType
    exportSession.timeRange = timeRange

    exportSession.exportAsynchronously {
      if exportSession.status == .completed {
        promise.resolve(outputURL.absoluteString)
        return
      }

      try? FileManager.default.removeItem(at: outputURL)
      export(
        asset: asset,
        outputURL: outputURL,
        outputFileType: outputFileType,
        timeRange: timeRange,
        presets: Array(presets.dropFirst()),
        promise: promise,
        lastError: exportSession.error
      )
    }
  }

  private static func transcodeLowBitrateAac(
    asset: AVAsset,
    outputURL: URL,
    timeRange: CMTimeRange,
    promise: Promise,
    passthroughError: Error?
  ) {
    guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
      let errorMsg = passthroughError?.localizedDescription ?? "No audio track found"
      promise.reject("ERR_EXPORT", errorMsg)
      return
    }

    do {
      try? FileManager.default.removeItem(at: outputURL)

      let reader = try AVAssetReader(asset: asset)
      reader.timeRange = timeRange

      let readerOutput = AVAssetReaderTrackOutput(
        track: audioTrack,
        outputSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVLinearPCMIsNonInterleaved: false,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
        ]
      )
      readerOutput.alwaysCopiesSampleData = false

      guard reader.canAdd(readerOutput) else {
        promise.reject("ERR_EXPORT", "Unable to read source audio")
        return
      }
      reader.add(readerOutput)

      let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
      let writerInput = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: aacOutputSettings(for: audioTrack)
      )
      writerInput.expectsMediaDataInRealTime = false

      guard writer.canAdd(writerInput) else {
        promise.reject("ERR_EXPORT", "Unable to write AAC audio")
        return
      }
      writer.add(writerInput)

      guard reader.startReading() else {
        let errorMsg = reader.error?.localizedDescription ?? "Unable to start reading source audio"
        promise.reject("ERR_EXPORT", errorMsg)
        return
      }

      guard writer.startWriting() else {
        reader.cancelReading()
        let errorMsg = writer.error?.localizedDescription ?? "Unable to start writing AAC audio"
        promise.reject("ERR_EXPORT", errorMsg)
        return
      }

      writer.startSession(atSourceTime: timeRange.start)

      let queue = DispatchQueue(label: "AudioTrimmer.low-bitrate-aac")
      writerInput.requestMediaDataWhenReady(on: queue) {
        while writerInput.isReadyForMoreMediaData {
          if let sampleBuffer = readerOutput.copyNextSampleBuffer() {
            if !writerInput.append(sampleBuffer) {
              reader.cancelReading()
              writerInput.markAsFinished()
              writer.cancelWriting()
              let errorMsg = writer.error?.localizedDescription ?? "Unable to append AAC audio"
              promise.reject("ERR_EXPORT", errorMsg)
              return
            }
          } else {
            writerInput.markAsFinished()
            writer.finishWriting {
              if reader.status == .failed {
                let errorMsg = reader.error?.localizedDescription ?? "Unable to read source audio"
                promise.reject("ERR_EXPORT", errorMsg)
                return
              }

              if writer.status == .completed {
                promise.resolve(outputURL.absoluteString)
              } else {
                let errorMsg = writer.error?.localizedDescription ?? "Unable to write AAC audio"
                promise.reject("ERR_EXPORT", errorMsg)
              }
            }
            return
          }
        }
      }
    } catch {
      let errorMsg = error.localizedDescription
      promise.reject("ERR_EXPORT", errorMsg)
    }
  }

  private static func aacOutputSettings(for audioTrack: AVAssetTrack) -> [String: Any] {
    var channelCount = 2
    var sampleRate = 44_100.0

    if let rawFormatDescription = audioTrack.formatDescriptions.first {
      let formatDescription = rawFormatDescription as! CMAudioFormatDescription
      guard let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee else {
        return [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVEncoderBitRateKey: fallbackAacBitRate,
          AVNumberOfChannelsKey: channelCount,
          AVSampleRateKey: sampleRate,
        ]
      }

      let sourceChannelCount = Int(streamDescription.mChannelsPerFrame)
      if sourceChannelCount > 0 {
        channelCount = min(sourceChannelCount, 2)
      }

      if streamDescription.mSampleRate.isFinite, streamDescription.mSampleRate > 0 {
        sampleRate = streamDescription.mSampleRate
      }
    }

    return [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVEncoderBitRateKey: fallbackAacBitRate,
      AVNumberOfChannelsKey: channelCount,
      AVSampleRateKey: sampleRate,
    ]
  }
}
