internal import ExpoModulesCore
import AVFoundation

// Phase 0 spike for Imported Audiobooks (docs/imported-audiobooks-implementation-plan.md).
// Reads what AVFoundation exposes for a local audio file and toggles iCloud backup exclusion.
class AudioImport: Module {
  func definition() -> ModuleDefinition {
    Name("AudioImport")

    AsyncFunction("readAudioMetadata") { (fileUrl: String) async throws -> [String: Any] in
      guard let url = Self.resolveFileURL(fileUrl) else {
        throw Exception(name: "ERR_URL", description: "Invalid file URL provided")
      }
      return try await Self.readMetadata(url: url)
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

  private static func isExcludedFromBackup(_ url: URL) throws -> Bool {
    // Re-create the URL so the read is not served from the URL's cached resource values.
    let fresh = URL(fileURLWithPath: url.path)
    return try fresh.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
  }

  private static func readMetadata(url: URL) async throws -> [String: Any] {
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
          artworkUri = writeArtwork(data)
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

  private static func writeArtwork(_ data: Data) -> String? {
    let isPng = data.starts(with: [0x89, 0x50, 0x4E, 0x47])
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("import-artwork-\(UUID().uuidString).\(isPng ? "png" : "jpg")")
    do {
      try data.write(to: url)
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
