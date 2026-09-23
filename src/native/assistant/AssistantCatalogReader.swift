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
    let request = AssistantDiagnostics.begin(.bookByEntityID, inputKind: .entityIdentifier)
    guard let id = AssistantBookID(rawValue: rawID) else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return nil
    }
    let context = AssistantRuntimeContextStore.shared.current()
    guard id.userId == context.userId else {
      request.complete(resultCount: 0, outcome: .unavailable)
      return nil
    }
    let result: [AssistantBookRow]? = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND library_item_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " LIMIT 1"
      return try Self.query(db: db, sql: sql, values: [userId, id.libraryItemId])
    }
    let rows = result ?? []
    request.complete(
      resultCount: rows.count,
      outcome: result == nil ? .unavailable : (rows.isEmpty ? .empty : .success)
    )
    return rows.first
  }

  func book(libraryItemID: String) -> AssistantBookRow? {
    let request = AssistantDiagnostics.begin(
      .bookByLibraryItemID,
      inputKind: .libraryItemIdentifier
    )
    guard !libraryItemID.isEmpty else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return nil
    }
    let context = AssistantRuntimeContextStore.shared.current()
    let result: [AssistantBookRow]? = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND library_item_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " LIMIT 1"
      return try Self.query(db: db, sql: sql, values: [userId, libraryItemID])
    }
    let rows = result ?? []
    request.complete(
      resultCount: rows.count,
      outcome: result == nil ? .unavailable : (rows.isEmpty ? .empty : .success)
    )
    return rows.first
  }

  func search(text: String, limit: Int = 10) -> [AssistantBookRow] {
    let request = AssistantDiagnostics.begin(.search, inputKind: .freeText)
    let normalized = AssistantText.normalize(text)
    guard !normalized.isEmpty, limit > 0 else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return []
    }
    switch query(AssistantSearchCriteria(text: text, sort: .relevance, limit: limit)) {
    case .unavailable, .libraryRequired:
      request.complete(resultCount: 0, outcome: .unavailable)
      return []
    case .success(let page):
      request.complete(resultCount: page.books.count, outcome: page.books.isEmpty ? .empty : .success)
      return page.books
    }
  }

  func booksByAuthor(text: String, limit: Int = 10) -> [AssistantBookRow] {
    let request = AssistantDiagnostics.begin(.booksByAuthor, inputKind: .authorText)
    let normalized = AssistantText.normalize(text)
    guard !normalized.isEmpty, limit > 0 else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return []
    }
    switch query(
      AssistantSearchCriteria(
        author: .combinedCreditContains(text),
        sort: .title,
        limit: limit
      )
    ) {
    case .unavailable, .libraryRequired:
      request.complete(resultCount: 0, outcome: .unavailable)
      return []
    case .success(let page):
      request.complete(resultCount: page.books.count, outcome: page.books.isEmpty ? .empty : .success)
      return page.books
    }
  }

  func query(_ criteria: AssistantSearchCriteria) -> AssistantCatalogRead {
    let request = AssistantDiagnostics.begin(.query, inputKind: criteria.diagnosticInputKind)
    let context = AssistantRuntimeContextStore.shared.current()
    let result = readInLibrary(context: context) { db, userId, libraryId, downloadedOnly in
      try Self.executeQuery(
        db: db,
        userId: userId,
        libraryId: libraryId,
        downloadedOnly: downloadedOnly,
        criteria: criteria
      )
    }
    switch result {
    case .libraryRequired:
      request.complete(resultCount: 0, outcome: .unavailable)
      return .libraryRequired
    case .unavailable:
      request.complete(resultCount: 0, outcome: .unavailable)
      return .unavailable
    case .value(let page):
      request.complete(
        resultCount: page.books.count,
        outcome: page.books.isEmpty ? .empty : .success
      )
      return .success(page)
    }
  }

  func playbackMatch(text: String, limit: Int = 10) -> AssistantPlaybackMatch {
    let normalized = AssistantText.normalize(text)
    guard !normalized.isEmpty else { return .none }
    switch query(AssistantSearchCriteria(text: text, sort: .relevance, limit: limit)) {
    case .unavailable:
      return .unavailable
    case .libraryRequired:
      return .libraryRequired
    case .success(let page):
      let exactTitles = page.books.filter { $0.titleNormalized == normalized }
      if exactTitles.count == 1, let unique = exactTitles.first {
        return .unique(unique)
      }
      if exactTitles.count > 1 {
        return .ambiguous(books: exactTitles, totalCount: exactTitles.count)
      }
      if page.books.count == 1, let unique = page.books.first {
        return .unique(unique)
      }
      if page.books.isEmpty {
        return .none
      }
      return .ambiguous(books: page.books, totalCount: page.totalCount)
    }
  }

  func authors(matching text: String? = nil, limit: Int = 25) -> AssistantCatalogReadAuthors {
    let request = AssistantDiagnostics.begin(.authors, inputKind: text == nil ? .none : .authorText)
    let criteriaLimit = min(max(limit, 1), 100)
    if let text, AssistantText.normalize(text).isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return .success([])
    }
    let context = AssistantRuntimeContextStore.shared.current()
    let result = readInLibrary(context: context) { db, userId, libraryId, downloadedOnly in
      try Self.executeAuthorQuery(
        db: db,
        userId: userId,
        libraryId: libraryId,
        downloadedOnly: downloadedOnly,
        matching: text,
        limit: criteriaLimit
      )
    }
    switch result {
    case .libraryRequired:
      request.complete(resultCount: 0, outcome: .unavailable)
      return .libraryRequired
    case .unavailable:
      request.complete(resultCount: 0, outcome: .unavailable)
      return .unavailable
    case .value(let credits):
      request.complete(resultCount: credits.count, outcome: credits.isEmpty ? .empty : .success)
      return .success(credits)
    }
  }

  func author(byID rawID: String) -> AssistantAuthorCredit? {
    let request = AssistantDiagnostics.begin(.authors, inputKind: .entityIdentifier)
    guard let parsed = AssistantAuthorCredit(rawID: rawID) else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return nil
    }
    let context = AssistantRuntimeContextStore.shared.current()
    guard parsed.userId == context.userId else {
      request.complete(resultCount: 0, outcome: .unavailable)
      return nil
    }
    let result = readInLibrary(context: context) { db, userId, libraryId, downloadedOnly in
      try Self.executeAuthorLookup(
        db: db,
        userId: userId,
        libraryId: libraryId,
        downloadedOnly: downloadedOnly,
        normalized: parsed.normalized
      )
    }
    guard case .value(let credit) = result else {
      request.complete(resultCount: 0, outcome: .unavailable)
      return nil
    }
    request.complete(resultCount: credit == nil ? 0 : 1, outcome: credit == nil ? .empty : .success)
    return credit
  }

  func suggested(limit: Int = 25) -> [AssistantBookRow] {
    let request = AssistantDiagnostics.begin(.suggested, inputKind: .none)
    guard limit > 0 else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return []
    }
    let context = AssistantRuntimeContextStore.shared.current()
    let result = readInLibrary(context: context) { db, userId, libraryId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND library_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY (progress_percent > 0 AND is_finished = 0) DESC, is_downloaded DESC, is_favorite DESC, last_played_at DESC, title COLLATE NOCASE LIMIT ?"
      return try Self.query(
        db: db,
        sql: sql,
        values: [userId, libraryId],
        integer: Int32(min(max(limit, 1), 100))
      )
    }.value
    let rows = result ?? []
    request.complete(
      resultCount: rows.count,
      outcome: result == nil ? .unavailable : (rows.isEmpty ? .empty : .success)
    )
    return rows
  }

  func all(limit: Int = 5_000) -> [AssistantBookRow] {
    let request = AssistantDiagnostics.begin(.all, inputKind: .none)
    guard limit > 0 else {
      request.complete(resultCount: 0, outcome: .invalidInput)
      return []
    }
    let context = AssistantRuntimeContextStore.shared.current()
    let result = readInLibrary(context: context) { db, userId, libraryId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND library_id = ?"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY title COLLATE NOCASE LIMIT ?"
      return try Self.query(
        db: db,
        sql: sql,
        values: [userId, libraryId],
        integer: Int32(min(max(limit, 1), 10_000))
      )
    }.value
    let rows = result ?? []
    request.complete(
      resultCount: rows.count,
      outcome: result == nil ? .unavailable : (rows.isEmpty ? .empty : .success)
    )
    return rows
  }

  func mostRecent() -> AssistantBookRow? {
    let request = AssistantDiagnostics.begin(.mostRecent, inputKind: .none)
    let context = AssistantRuntimeContextStore.shared.current()
    let result: [AssistantBookRow]? = read(context: context) { db, userId, downloadedOnly in
      var sql = Self.selectColumns + " WHERE user_id = ? AND last_played_at IS NOT NULL"
      if downloadedOnly { sql += " AND is_downloaded = 1" }
      sql += " ORDER BY last_played_at DESC LIMIT 1"
      return try Self.query(db: db, sql: sql, values: [userId])
    }
    let rows = result ?? []
    request.complete(
      resultCount: rows.count,
      outcome: result == nil ? .unavailable : (rows.isEmpty ? .empty : .success)
    )
    return rows.first
  }

  private enum LibraryRead<T> {
    case libraryRequired
    case unavailable
    case value(T)

    var value: T? {
      if case .value(let value) = self { return value }
      return nil
    }
  }

  private func readInLibrary<T>(
    context: AssistantRuntimeContext,
    body: (OpaquePointer, String, String, Bool) throws -> T
  ) -> LibraryRead<T> {
    guard let libraryId = context.libraryId else { return .libraryRequired }
    let result = read(context: context) { db, userId, downloadedOnly in
      try body(db, userId, libraryId, downloadedOnly)
    }
    guard let result else { return .unavailable }
    return .value(result)
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

  private enum SQLValue {
    case text(String)
    case int(Int32)
  }

  private static func executeQuery(
    db: OpaquePointer,
    userId: String,
    libraryId: String,
    downloadedOnly: Bool,
    criteria: AssistantSearchCriteria
  ) throws -> AssistantSearchResult {
    var whereSQL = "user_id = ? AND library_id = ?"
    var values: [SQLValue] = [.text(userId), .text(libraryId)]

    if downloadedOnly || criteria.downloaded == true {
      whereSQL += " AND is_downloaded = 1"
    } else if criteria.downloaded == false {
      whereSQL += " AND is_downloaded = 0"
    }

    if let finished = criteria.finished {
      whereSQL += " AND is_finished = \(finished ? 1 : 0)"
    }

    if let text = criteria.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      let tokens = criteria.textTokens
      if tokens.isEmpty {
        whereSQL += " AND 0"
      } else {
        appendWordPrefixClause(
          column: "search_text",
          tokens: tokens,
          whereSQL: &whereSQL,
          values: &values
        )
      }
    }

    if let author = criteria.author {
      switch author {
      case .combinedCreditEquals(let raw):
        let normalized = AssistantText.normalize(raw)
        if normalized.isEmpty {
          whereSQL += " AND 0"
        } else {
          whereSQL += " AND author_normalized = ?"
          values.append(.text(normalized))
        }
      case .combinedCreditContains(let raw):
        let tokens = AssistantText.tokens(from: raw)
        if tokens.isEmpty {
          whereSQL += " AND 0"
        } else {
          appendWordPrefixClause(
            column: "author_normalized",
            tokens: tokens,
            whereSQL: &whereSQL,
            values: &values
          )
        }
      }
    }

    let countSQL = "SELECT COUNT(*) FROM assistant_catalog WHERE \(whereSQL)"
    let totalCount = try scalarInt(db: db, sql: countSQL, values: values)

    var orderValues: [SQLValue] = []
    let orderSQL = orderClause(criteria: criteria, orderValues: &orderValues)
    let pageSQL = """
      \(selectColumns)
      WHERE \(whereSQL)
      \(orderSQL)
      LIMIT ? OFFSET ?
      """
    var pageValues = values + orderValues
    pageValues.append(.int(Int32(criteria.limit)))
    pageValues.append(.int(Int32(criteria.offset)))
    let books = try query(db: db, sql: pageSQL, values: pageValues)
    return AssistantSearchResult(books: books, totalCount: totalCount)
  }

  private static func executeAuthorQuery(
    db: OpaquePointer,
    userId: String,
    libraryId: String,
    downloadedOnly: Bool,
    matching: String?,
    limit: Int
  ) throws -> [AssistantAuthorCredit] {
    var whereSQL = "user_id = ? AND library_id = ? AND author_normalized != ''"
    var values: [SQLValue] = [.text(userId), .text(libraryId)]
    if downloadedOnly { whereSQL += " AND is_downloaded = 1" }
    if let matching {
      let tokens = AssistantText.tokens(from: matching)
      if tokens.isEmpty {
        whereSQL += " AND 0"
      } else {
        appendWordPrefixClause(
          column: "author_normalized",
          tokens: tokens,
          whereSQL: &whereSQL,
          values: &values
        )
      }
    }
    let sql = """
      SELECT MIN(author), author_normalized, COUNT(*)
      FROM assistant_catalog
      WHERE \(whereSQL)
      GROUP BY author_normalized
      ORDER BY COUNT(*) DESC, MIN(author) COLLATE NOCASE ASC
      LIMIT ?
      """
    values.append(.int(Int32(limit)))
    return try queryAuthors(db: db, sql: sql, values: values, userId: userId)
  }

  private static func executeAuthorLookup(
    db: OpaquePointer,
    userId: String,
    libraryId: String,
    downloadedOnly: Bool,
    normalized: String
  ) throws -> AssistantAuthorCredit? {
    var sql = """
      SELECT MIN(author), author_normalized, COUNT(*)
      FROM assistant_catalog
      WHERE user_id = ? AND library_id = ? AND author_normalized = ?
      """
    if downloadedOnly { sql += " AND is_downloaded = 1" }
    sql += " GROUP BY author_normalized LIMIT 1"
    return try queryAuthors(
      db: db,
      sql: sql,
      values: [.text(userId), .text(libraryId), .text(normalized)],
      userId: userId
    ).first
  }

  private static func queryAuthors(
    db: OpaquePointer,
    sql: String,
    values: [SQLValue],
    userId: String
  ) throws -> [AssistantAuthorCredit] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw AssistantCatalogError.prepare(message: String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }
    try bind(statement, values: values)
    var credits: [AssistantAuthorCredit] = []
    while true {
      let result = sqlite3_step(statement)
      if result == SQLITE_DONE { return credits }
      guard result == SQLITE_ROW else {
        throw AssistantCatalogError.step(message: String(cString: sqlite3_errmsg(db)))
      }
      let displayName = text(statement, 0) ?? ""
      let normalized = text(statement, 1) ?? ""
      let bookCount = Int(sqlite3_column_int64(statement, 2))
      if let credit = AssistantAuthorCredit(
        userId: userId,
        displayName: displayName,
        normalized: normalized,
        bookCount: bookCount
      ) {
        credits.append(credit)
      }
    }
  }

  private static func appendWordPrefixClause(
    column: String,
    tokens: [String],
    whereSQL: inout String,
    values: inout [SQLValue]
  ) {
    guard !tokens.isEmpty else { return }
    let clause = tokens.map { token -> String in
      values.append(.text(token))
      values.append(.text("\(escapeLike(token))%"))
      values.append(.text("% \(escapeLike(token))%"))
      return "(\(column) = ? OR \(column) LIKE ? ESCAPE '\\' OR \(column) LIKE ? ESCAPE '\\')"
    }.joined(separator: " AND ")
    whereSQL += " AND \(clause)"
  }

  private static func orderClause(
    criteria: AssistantSearchCriteria,
    orderValues: inout [SQLValue]
  ) -> String {
    let ties = "title COLLATE NOCASE ASC, library_item_id ASC"
    switch criteria.sort {
    case .title:
      return "ORDER BY \(ties)"
    case .author:
      return "ORDER BY author COLLATE NOCASE ASC, \(ties)"
    case .recent:
      return "ORDER BY COALESCE(last_played_at, 0) DESC, \(ties)"
    case .relevance:
      let query = criteria.normalizedText
      if query.isEmpty {
        return "ORDER BY \(ties)"
      }
      orderValues.append(.text(query))
      orderValues.append(.text("\(escapeLike(query))%"))
      orderValues.append(.text("%\(escapeLike(query))%"))
      orderValues.append(.text("%\(escapeLike(query))%"))
      orderValues.append(.text("%\(escapeLike(query))%"))
      orderValues.append(.text("%\(escapeLike(query))%"))
      return """
        ORDER BY CASE
          WHEN title_normalized = ? THEN 0
          WHEN title_normalized LIKE ? ESCAPE '\\' THEN 1
          WHEN title_normalized LIKE ? ESCAPE '\\' THEN 2
          WHEN series_normalized LIKE ? ESCAPE '\\' THEN 3
          WHEN author_normalized LIKE ? ESCAPE '\\' THEN 4
          WHEN narrator_normalized LIKE ? ESCAPE '\\' THEN 5
          ELSE 6
        END,
        CASE WHEN progress_percent > 0 AND is_finished = 0 THEN 0 ELSE 1 END,
        COALESCE(last_played_at, 0) DESC,
        \(ties)
        """
    }
  }

  private static func scalarInt(
    db: OpaquePointer,
    sql: String,
    values: [SQLValue]
  ) throws -> Int {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw AssistantCatalogError.prepare(message: String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }
    try bind(statement, values: values)
    guard sqlite3_step(statement) == SQLITE_ROW else {
      throw AssistantCatalogError.step(message: String(cString: sqlite3_errmsg(db)))
    }
    return Int(sqlite3_column_int64(statement, 0))
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
    var binds: [SQLValue] = values.map { .text($0) }
    if let integer { binds.append(.int(integer)) }
    return try query(db: db, sql: sql, values: binds)
  }

  private static func query(
    db: OpaquePointer,
    sql: String,
    values: [SQLValue]
  ) throws -> [AssistantBookRow] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw AssistantCatalogError.prepare(message: String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(statement) }
    try bind(statement, values: values)

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

  private static func bind(_ statement: OpaquePointer, values: [SQLValue]) throws {
    for (offset, value) in values.enumerated() {
      let index = Int32(offset + 1)
      switch value {
      case .text(let text):
        sqlite3_bind_text(statement, index, text, -1, sqliteTransient)
      case .int(let integer):
        sqlite3_bind_int(statement, index, integer)
      }
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
