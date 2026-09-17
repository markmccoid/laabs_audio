import Foundation
import OSLog
import SQLite3

struct AssistantBookID: Hashable, Sendable {
  let userId: String
  let libraryItemId: String

  var rawValue: String { "\(userId)|\(libraryItemId)" }

  init?(rawValue: String) {
    let parts = rawValue.split(separator: "|", omittingEmptySubsequences: false)
    guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
    userId = String(parts[0])
    libraryItemId = String(parts[1])
  }

  init?(userId: String, libraryItemId: String) {
    guard !userId.isEmpty, !libraryItemId.isEmpty,
      !userId.contains("|"), !libraryItemId.contains("|")
    else { return nil }
    self.userId = userId
    self.libraryItemId = libraryItemId
  }
}

enum AssistantText {
  static func normalize(_ value: String) -> String {
    let folded = value.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
      .lowercased(with: Locale(identifier: "en_US_POSIX"))
    var result = ""
    var pendingSpace = false

    for scalar in folded.unicodeScalars {
      let isASCIILetter = scalar.value >= 97 && scalar.value <= 122
      let isASCIIDigit = scalar.value >= 48 && scalar.value <= 57
      if isASCIILetter || isASCIIDigit {
        if pendingSpace && !result.isEmpty { result.append(" ") }
        result.unicodeScalars.append(scalar)
        pendingSpace = false
      } else {
        pendingSpace = true
      }
    }
    return result
  }
}

struct AssistantBookRow: Identifiable, Hashable, Sendable {
  let userId: String
  let libraryItemId: String
  let libraryId: String
  let title: String
  let subtitle: String?
  let author: String?
  let narrator: String?
  let seriesName: String?
  let seriesSequence: String?
  let durationSeconds: Double
  let coverPath: String?
  let coverURL: String?
  let titleNormalized: String
  let authorNormalized: String
  let seriesNormalized: String
  let narratorNormalized: String
  let progressPercent: Double
  let currentTimeSeconds: Double
  let isFinished: Bool
  let lastPlayedAt: Int64?
  let isDownloaded: Bool
  let isFavorite: Bool

  var id: String { AssistantBookID(userId: userId, libraryItemId: libraryItemId)!.rawValue }
  var isInProgress: Bool { progressPercent > 0 && !isFinished }
}

final class AssistantCatalogReader: @unchecked Sendable {
  static let shared = AssistantCatalogReader()

  private static let contractVersion: Int32 = 1
  private static let logger = Logger(subsystem: "com.markmccoid.laabs-audio", category: "assistant-catalog")
  private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  private let queue = DispatchQueue(label: "com.markmccoid.laabs-audio.assistant-catalog")
  private var connection: OpaquePointer?
  private var openPath: String?

  deinit {
    if let connection { sqlite3_close(connection) }
  }

  func book(byID rawID: String) -> AssistantBookRow? {
    guard let id = AssistantBookID(rawValue: rawID) else { return nil }
    let context = AssistantRuntimeContextStore.shared.current()
    guard id.userId == context.userId else { return nil }
    let rows: [AssistantBookRow] = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND library_item_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " LIMIT 1"
      return try Self.query(db: db, sql: sql, values: [userId, id.libraryItemId])
    } ?? []
    return rows.first
  }

  func book(libraryItemID: String) -> AssistantBookRow? {
    guard !libraryItemID.isEmpty else { return nil }
    let context = AssistantRuntimeContextStore.shared.current()
    let rows: [AssistantBookRow] = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND library_item_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " LIMIT 1"
      return try Self.query(db: db, sql: sql, values: [userId, libraryItemID])
    } ?? []
    return rows.first
  }

  func search(text: String, limit: Int = 10) -> [AssistantBookRow] {
    let normalized = AssistantText.normalize(text)
    guard !normalized.isEmpty, limit > 0 else { return [] }
    let context = AssistantRuntimeContextStore.shared.current()
    let rows: [AssistantBookRow] = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND search_text LIKE ? ESCAPE '\\'"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      return try Self.query(db: db, sql: sql, values: [userId, "%\(Self.escapeLike(normalized))%"])
    } ?? []

    return rows.sorted { lhs, rhs in
      let leftScore = Self.rank(lhs, for: normalized)
      let rightScore = Self.rank(rhs, for: normalized)
      if leftScore != rightScore { return leftScore > rightScore }
      if lhs.isInProgress != rhs.isInProgress { return lhs.isInProgress }
      if lhs.lastPlayedAt != rhs.lastPlayedAt { return (lhs.lastPlayedAt ?? 0) > (rhs.lastPlayedAt ?? 0) }
      return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
    }.prefix(limit).map { $0 }
  }

  func booksByAuthor(text: String, limit: Int = 10) -> [AssistantBookRow] {
    let normalized = AssistantText.normalize(text)
    guard !normalized.isEmpty, limit > 0 else { return [] }
    let context = AssistantRuntimeContextStore.shared.current()
    return read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND author_normalized LIKE ? ESCAPE '\\'"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY title COLLATE NOCASE LIMIT ?"
      return try Self.query(
        db: db,
        sql: sql,
        values: [userId, "%\(Self.escapeLike(normalized))%"],
        integer: Int32(min(max(limit, 1), 100))
      )
    } ?? []
  }

  func suggested(limit: Int = 25) -> [AssistantBookRow] {
    guard limit > 0 else { return [] }
    let context = AssistantRuntimeContextStore.shared.current()
    return read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY (progress_percent > 0 AND is_finished = 0) DESC, is_downloaded DESC, is_favorite DESC, last_played_at DESC, title COLLATE NOCASE LIMIT ?"
      return try Self.query(
        db: db,
        sql: sql,
        values: [userId],
        integer: Int32(min(max(limit, 1), 100))
      )
    } ?? []
  }

  func all(limit: Int = 5_000) -> [AssistantBookRow] {
    guard limit > 0 else { return [] }
    let context = AssistantRuntimeContextStore.shared.current()
    return read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY title COLLATE NOCASE LIMIT ?"
      return try Self.query(
        db: db,
        sql: sql,
        values: [userId],
        integer: Int32(min(max(limit, 1), 10_000))
      )
    } ?? []
  }

  func mostRecent() -> AssistantBookRow? {
    let context = AssistantRuntimeContextStore.shared.current()
    let rows: [AssistantBookRow] = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND last_played_at IS NOT NULL"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY last_played_at DESC LIMIT 1"
      return try Self.query(db: db, sql: sql, values: [userId])
    } ?? []
    return rows.first
  }

  private func read<T>(
    context: AssistantRuntimeContext,
    body: (OpaquePointer, String, Bool) throws -> T
  ) -> T? {
    guard let path = context.dbPath, let userId = context.userId else { return nil }
    return queue.sync {
      do {
        let db = try database(at: path)
        guard try hasSupportedContract(db: db, userId: userId) else { return nil }
        return try body(db, userId, context.accessMode == .downloadedSessionOnly)
      } catch {
        Self.logger.error("Assistant catalog read failed: \(String(describing: error), privacy: .public)")
        return nil
      }
    }
  }

  private func database(at path: String) throws -> OpaquePointer {
    if openPath == path, let connection { return connection }
    if let connection { sqlite3_close(connection) }
    connection = nil
    openPath = nil

    var db: OpaquePointer?
    let code = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil)
    guard code == SQLITE_OK, let db else {
      if let db { sqlite3_close(db) }
      throw AssistantCatalogError.sqlite(code: code)
    }
    connection = db
    openPath = path
    return db
  }

  private func hasSupportedContract(db: OpaquePointer, userId: String) throws -> Bool {
    let sql = "SELECT contract_version FROM assistant_catalog_meta WHERE user_id = ? LIMIT 1"
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw AssistantCatalogError.prepare(message: String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, userId, -1, Self.sqliteTransient)
    guard sqlite3_step(statement) == SQLITE_ROW else { return false }
    let version = sqlite3_column_int(statement, 0)
    if version != Self.contractVersion {
      Self.logger.error("Ignoring Assistant Catalog contract \(version); expected \(Self.contractVersion)")
      return false
    }
    return true
  }

  private static let selectColumns = """
    SELECT user_id, library_item_id, library_id, title, subtitle, author, narrator,
      series_name, series_sequence, duration_seconds, cover_path, cover_url,
      title_normalized, author_normalized, series_normalized, narrator_normalized,
      progress_percent, current_time_seconds, is_finished, last_played_at,
      is_downloaded, is_favorite
    FROM assistant_catalog
    """

  private static func query(
    db: OpaquePointer,
    sql: String,
    values: [String],
    integer: Int32? = nil
  ) throws -> [AssistantBookRow] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw AssistantCatalogError.prepare(message: String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }

    for (offset, value) in values.enumerated() {
      sqlite3_bind_text(statement, Int32(offset + 1), value, -1, sqliteTransient)
    }
    if let integer { sqlite3_bind_int(statement, Int32(values.count + 1), integer) }

    var rows: [AssistantBookRow] = []
    while true {
      let result = sqlite3_step(statement)
      if result == SQLITE_DONE { return rows }
      guard result == SQLITE_ROW else {
        throw AssistantCatalogError.step(message: String(cString: sqlite3_errmsg(db)))
      }
      rows.append(row(statement))
    }
  }

  private static func row(_ statement: OpaquePointer) -> AssistantBookRow {
    AssistantBookRow(
      userId: text(statement, 0) ?? "",
      libraryItemId: text(statement, 1) ?? "",
      libraryId: text(statement, 2) ?? "",
      title: text(statement, 3) ?? "Audiobook",
      subtitle: text(statement, 4),
      author: text(statement, 5),
      narrator: text(statement, 6),
      seriesName: text(statement, 7),
      seriesSequence: text(statement, 8),
      durationSeconds: sqlite3_column_double(statement, 9),
      coverPath: text(statement, 10),
      coverURL: text(statement, 11),
      titleNormalized: text(statement, 12) ?? "",
      authorNormalized: text(statement, 13) ?? "",
      seriesNormalized: text(statement, 14) ?? "",
      narratorNormalized: text(statement, 15) ?? "",
      progressPercent: min(max(sqlite3_column_double(statement, 16), 0), 1),
      currentTimeSeconds: max(sqlite3_column_double(statement, 17), 0),
      isFinished: sqlite3_column_int(statement, 18) != 0,
      lastPlayedAt: sqlite3_column_type(statement, 19) == SQLITE_NULL ? nil : sqlite3_column_int64(statement, 19),
      isDownloaded: sqlite3_column_int(statement, 20) != 0,
      isFavorite: sqlite3_column_int(statement, 21) != 0
    )
  }

  private static func text(_ statement: OpaquePointer, _ column: Int32) -> String? {
    guard sqlite3_column_type(statement, column) != SQLITE_NULL,
      let value = sqlite3_column_text(statement, column)
    else { return nil }
    return String(cString: value)
  }

  private static func rank(_ row: AssistantBookRow, for query: String) -> Int {
    if row.titleNormalized == query { return 100 }
    if row.titleNormalized.hasPrefix(query) { return 80 }
    if row.titleNormalized.contains(query) { return 60 }
    if row.seriesNormalized.contains(query) { return 50 }
    if row.authorNormalized.contains(query) { return 40 }
    if row.narratorNormalized.contains(query) { return 30 }
    return 0
  }

  private static func escapeLike(_ value: String) -> String {
    value.replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "%", with: "\\%")
      .replacingOccurrences(of: "_", with: "\\_")
  }
}

private enum AssistantCatalogError: Error {
  case sqlite(code: Int32)
  case prepare(message: String)
  case step(message: String)
}
