internal import ExpoModulesCore
import AVFoundation
import UIKit
import UniformTypeIdentifiers

// Phase 0 spike for Imported Audiobooks (docs/imported-audiobooks-implementation-plan.md).
// Reads what AVFoundation exposes for a local audio file and toggles iCloud backup exclusion.
class AudioImport: Module {
  private var pickerDelegate: AudioPickerDelegate?

  func definition() -> ModuleDefinition {
    Name("AudioImport")

    // Fired once the user has chosen a file and the coordinated copy (which may first download it
    // from iCloud) begins, so the UI can switch from "picker open" to "importing".
    Events("onImportCopyStarted")

    // Native alternative to expo-document-picker: opens the picker in place (asCopy: false) and does
    // one coordinated copy on a background queue, so a large file never blocks the main thread
    // and nothing is left behind in tmp/<bundle>-Inbox.
    // `kind` is "audio" (default) or "image" (cover art).
    AsyncFunction("pickAndCopyAudio") { (destinationDirectory: String, kind: String?, promise: Promise) in
      if self.pickerDelegate != nil {
        promise.reject("ERR_IN_PROGRESS", "A pick is already in progress")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController(),
            let destination = Self.resolveFileURL(destinationDirectory) else {
        promise.reject("ERR_PRESENT", "Cannot present picker")
        return
      }
      var types: [UTType] = kind == "image" ? [.image] : [.audio]
      if kind != "image", let m4b = UTType("com.apple.m4b-audio") { types.append(m4b) }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
      picker.allowsMultipleSelection = false
      let presentedAt = Date()
      // Strong capture is fine: the delegate is released when the pick finishes.
      let delegate = AudioPickerDelegate { url in
        self.pickerDelegate = nil
        guard let url else {
          promise.resolve(["canceled": true])
          return
        }
        let pickedAt = Date()
        self.sendEvent("onImportCopyStarted", ["name": url.lastPathComponent])
        DispatchQueue.global(qos: .userInitiated).async {
          do {
            let result = try Self.coordinatedCopy(from: url, into: destination)
            var payload = result
            payload["canceled"] = false
            payload["pickerOpenMs"] = pickedAt.timeIntervalSince(presentedAt) * 1000
            promise.resolve(payload)
          } catch {
            promise.reject("ERR_COPY", error.localizedDescription)
          }
        }
      }
      self.pickerDelegate = delegate
      picker.delegate = delegate
      picker.presentationController?.delegate = delegate
      presenter.present(picker, animated: true)
    }.runOnQueue(.main)

    // Sizes of the places expo-document-picker leaves copies behind.
    AsyncFunction("pickerLeftoverReport") { () -> [String: Any] in
      return Self.leftoverDirectories().reduce(into: [String: Any]()) { report, entry in
        report[entry.key] = ["bytes": NSNumber(value: Self.directorySize(entry.value)), "files": Self.fileCount(entry.value)]
      }
    }

    AsyncFunction("clearPickerLeftovers") { () -> Bool in
      for url in Self.leftoverDirectories().values {
        try? FileManager.default.removeItem(at: url)
      }
      return true
    }

    // `artworkDirectory`, when given, receives the embedded cover as cover.jpg/png. It must be a
    // folder JS may read (Documents or Caches): expo-file-system cannot touch tmp/.
    AsyncFunction("readAudioMetadata") { (fileUrl: String, artworkDirectory: String?) async throws -> [String: Any] in
      guard let url = Self.resolveFileURL(fileUrl) else {
        throw Exception(name: "ERR_URL", description: "Invalid file URL provided")
      }
      let artworkURL = artworkDirectory.flatMap { Self.resolveFileURL($0) }
      return try await Self.readMetadata(url: url, artworkDirectory: artworkURL)
    }

    AsyncFunction("setExcludedFromBackup") { (fileUrl: String, excluded: Bool) throws -> Bool in
      guard var url = Self.resolveFileURL(fileUrl) else {
        throw Exception(name: "ERR_URL", description: "Invalid file URL provided")
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = excluded
      try url.setResourceValues(values)
      return try Self.isExcludedFromBackup(url)
    }

    AsyncFunction("isExcludedFromBackup") { (fileUrl: String) throws -> Bool in
      guard let url = Self.resolveFileURL(fileUrl) else {
        throw Exception(name: "ERR_URL", description: "Invalid file URL provided")
      }
      return try Self.isExcludedFromBackup(url)
    }
  }

  private static func coordinatedCopy(from source: URL, into directory: URL) throws -> [String: Any] {
    let accessing = source.startAccessingSecurityScopedResource()
    defer { if accessing { source.stopAccessingSecurityScopedResource() } }

    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let target = directory.appendingPathComponent(source.lastPathComponent)
    try? FileManager.default.removeItem(at: target)

    let coordinationStarted = Date()
    var coordinationWaitMs: Double = 0
    var copyMs: Double = 0
    var copyError: Error?
    var coordinatorError: NSError?
    // Coordinated reading makes iOS download an iCloud-evicted file before the block runs.
    NSFileCoordinator().coordinate(readingItemAt: source, options: [.withoutChanges], error: &coordinatorError) { readURL in
      coordinationWaitMs = Date().timeIntervalSince(coordinationStarted) * 1000
      let copyStarted = Date()
      do {
        try FileManager.default.copyItem(at: readURL, to: target)
      } catch {
        copyError = error
      }
      copyMs = Date().timeIntervalSince(copyStarted) * 1000
    }
    if let error = coordinatorError ?? copyError { throw error }

    let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.int64Value ?? 0
    return [
      "uri": target.absoluteString,
      "name": source.lastPathComponent,
      "size": NSNumber(value: size),
      "securityScoped": accessing,
      "coordinationWaitMs": coordinationWaitMs,
      "copyMs": copyMs,
    ]
  }

  private static func leftoverDirectories() -> [String: URL] {
    let fm = FileManager.default
    let bundleId = Bundle.main.bundleIdentifier ?? ""
    var result: [String: URL] = [
      "inbox": fm.temporaryDirectory.appendingPathComponent("\(bundleId)-Inbox", isDirectory: true),
    ]
    if let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first {
      result["documentPickerCache"] = caches.appendingPathComponent("DocumentPicker", isDirectory: true)
    }
    return result
  }

  private static func directorySize(_ url: URL) -> Int64 {
    guard let enumerator = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
    var total: Int64 = 0
    for case let file as URL in enumerator {
      total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    return total
  }

  private static func fileCount(_ url: URL) -> Int {
    (try? FileManager.default.contentsOfDirectory(atPath: url.path).count) ?? 0
  }

  private static func isExcludedFromBackup(_ url: URL) throws -> Bool {
    // Re-create the URL so the read is not served from the URL's cached resource values.
    let fresh = URL(fileURLWithPath: url.path)
    return try fresh.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
  }

  private static func readMetadata(url: URL, artworkDirectory: URL?) async throws -> [String: Any] {
    let started = Date()
    let asset = AVURLAsset(url: url)
    let (duration, isPlayable, commonMetadata, allMetadata, formats, chapterLocales) = try await asset.load(
      .duration, .isPlayable, .commonMetadata, .metadata, .availableMetadataFormats, .availableChapterLocales
    )

    var common: [String: Any] = [:]
    var artworkUri: String? = nil
    for item in commonMetadata {
      guard let key = item.commonKey?.rawValue else { continue }
      if item.commonKey == .commonKeyArtwork {
        if artworkUri == nil, let data = try? await item.load(.dataValue) {
          artworkUri = writeArtwork(data, into: artworkDirectory)
        }
        continue
      }
      if common[key] == nil, let value = try? await item.load(.stringValue) {
        common[key] = value
      }
    }

    // Every format-specific item, so the spike can see where narrator/description live (e.g. ©wrt, ©nrt, desc, TXXX).
    var raw: [[String: Any]] = []
    for format in formats {
      let items = (try? await asset.loadMetadata(for: format)) ?? []
      for item in items {
        let identifier = item.identifier?.rawValue ?? "?"
        if item.commonKey == .commonKeyArtwork || identifier.lowercased().contains("covr") || identifier.contains("APIC") {
          raw.append(["format": format.rawValue, "identifier": identifier, "value": "<artwork>"])
          continue
        }
        let value = (try? await item.load(.stringValue)) ?? nil
        raw.append([
          "format": format.rawValue,
          "identifier": identifier,
          "value": value.map { String($0.prefix(200)) } ?? NSNull(),
        ])
      }
    }

    var chapters: [[String: Any]] = []
    let locales = chapterLocales.isEmpty ? [Locale.current] : chapterLocales
    if let locale = locales.first {
      let groups = (try? await asset.loadChapterMetadataGroups(withTitleLocale: locale, containingItemsWithCommonKeys: [])) ?? []
      for (index, group) in groups.enumerated() {
        var title: String? = nil
        if let titleItem = AVMetadataItem.metadataItems(from: group.items, filteredByIdentifier: .commonIdentifierTitle).first {
          title = try? await titleItem.load(.stringValue)
        }
        chapters.append([
          "index": index,
          "title": title ?? NSNull(),
          "startMs": group.timeRange.start.seconds * 1000,
          "durationMs": group.timeRange.duration.seconds * 1000,
        ])
      }
    }

    var codec: String? = nil
    if let track = try? await asset.loadTracks(withMediaType: .audio).first,
       let description = try? await track.load(.formatDescriptions).first {
      let subtype = CMFormatDescriptionGetMediaSubType(description)
      codec = fourCharString(subtype)
    }

    let fileSize = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value

    return [
      "uri": url.absoluteString,
      "fileName": url.lastPathComponent,
      "fileSize": fileSize.map { NSNumber(value: $0) } ?? NSNull(),
      "durationMs": duration.seconds.isFinite ? duration.seconds * 1000 : NSNull(),
      "isPlayable": isPlayable,
      "codec": codec ?? NSNull(),
      "metadataFormats": formats.map { $0.rawValue },
      "common": common,
      "artworkUri": artworkUri ?? NSNull(),
      "chapterLocales": chapterLocales.map { $0.identifier },
      "chapters": chapters,
      "rawMetadataCount": allMetadata.count,
      "raw": raw,
      "readMs": Date().timeIntervalSince(started) * 1000,
    ]
  }

  private static func writeArtwork(_ data: Data, into directory: URL?) -> String? {
    let isPng = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
    let fileName = directory == nil ? "import-artwork-\(UUID().uuidString)" : "cover"
    let folder = directory ?? FileManager.default.temporaryDirectory
    let url = folder.appendingPathComponent("\(fileName).\(isPng ? "png" : "jpg")")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
      return url.absoluteString
    } catch {
      return nil
    }
  }

  private static func fourCharString(_ code: FourCharCode) -> String {
    let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xFF) }
    return String(bytes: bytes, encoding: .ascii)?.trimmingCharacters(in: .whitespaces) ?? "\(code)"
  }

  private static func resolveFileURL(_ value: String) -> URL? {
    if value.hasPrefix("file://") {
      return URL(string: value)
        ?? URL(fileURLWithPath: String(value.dropFirst("file://".count)).removingPercentEncoding ?? "")
    }
    if value.hasPrefix("/") {
      return URL(fileURLWithPath: value)
    }
    return URL(string: value)
  }
}

private final class AudioPickerDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var completion: ((URL?) -> Void)?

  init(completion: @escaping (URL?) -> Void) {
    self.completion = completion
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(nil)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(nil)
  }

  private func finish(_ url: URL?) {
    guard let completion else { return }
    self.completion = nil
    completion(url)
  }
}
