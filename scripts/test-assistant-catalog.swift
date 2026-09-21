// Run from the repository root:
// xcrun swiftc src/native/assistant/AssistantDiagnostics.swift src/native/assistant/AssistantRuntimeContext.swift src/native/assistant/AssistantSearchCriteria.swift src/native/assistant/AssistantCatalogReader.swift scripts/test-assistant-catalog.swift -lsqlite3 -o /tmp/test-assistant-catalog && /tmp/test-assistant-catalog
import Foundation
import SQLite3

@main
struct AssistantCatalogTests {
  static func main() {
    let dbURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      "assistant-catalog-test-\(UUID().uuidString).sqlite"
    )
    defer { try? FileManager.default.removeItem(at: dbURL) }

    let db = openDatabase(at: dbURL.path)
    defer { sqlite3_close(db) }
    createSchema(db)
    seed(db)

    AssistantRuntimeContextStore.shared.publish(
      AssistantRuntimeContext(
        dbPath: dbURL.path,
        userId: "user-a",
        accessMode: .serverBrowsing,
        canAttemptStreaming: true
      )
    )

    assertNormalize()
    assertSharedFixtures()
    assertEmptyAndWildcards()
    assertAuthorCountAndPagination()
    assertDuplicateTitlesStayAmbiguous()
    assertFourOrMoreRetained()
    assertAuthorCredits()
    assertSearchCopy()
    assertWrongUserAndContract(db: db, dbPath: dbURL.path)
    assertDownloadedSession(dbPath: dbURL.path)

    AssistantRuntimeContextStore.shared.publish(.disabled)
    print("Assistant catalog query tests passed.")
  }

  static func assertNormalize() {
    let cases: [(String, String)] = [
      ("The Shining", "the shining"),
      ("Dune: Messiah", "dune messiah"),
      ("Stephen King", "stephen king"),
      ("Björk", "bjork"),
      ("  L'Étranger — Albert Camus  ", "l etranger albert camus"),
      ("Volume 2.5 / Part #3", "volume 2 5 part 3"),
    ]
    for (input, expected) in cases {
      let actual = AssistantText.normalize(input)
      precondition(actual == expected, "normalize \(input) => \(actual), expected \(expected)")
    }
  }

  static func assertSharedFixtures() {
    let fixturesURL = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("src/assistant/__fixtures__/assistant-search-match-fixtures.json")
    let data = try! Data(contentsOf: fixturesURL)
    let fixtures = try! JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    for fixture in fixtures {
      let id = fixture["id"] as! String
      let query = fixture["query"] as! String
      let shouldMatch = fixture["shouldMatch"] as! Bool
      let titles = Set(searchTitles(query))
      let title = fixture["title"] as! String
      let matched = titles.contains(title)
      precondition(matched == shouldMatch, "fixture \(id): match=\(matched) expected \(shouldMatch)")
    }
  }

  static func assertEmptyAndWildcards() {
    precondition(AssistantCatalogReader.shared.search(text: "").isEmpty)
    precondition(AssistantCatalogReader.shared.search(text: "%%%").isEmpty)
    precondition(AssistantCatalogReader.shared.search(text: "___").isEmpty)
    switch AssistantCatalogReader.shared.query(AssistantSearchCriteria(text: "%_%")) {
    case .unavailable:
      preconditionFailure("wildcard query unavailable")
    case .success(let page):
      precondition(page.totalCount == 0, "literal wildcards must not match the catalog")
      precondition(page.books.isEmpty)
    }
    switch AssistantCatalogReader.shared.query(
      AssistantSearchCriteria(author: .combinedCreditContains("%%%"))
    ) {
    case .unavailable:
      preconditionFailure("author wildcard query unavailable")
    case .success(let page):
      precondition(page.totalCount == 0, "empty author tokens must not return the whole catalog")
    }
    switch AssistantCatalogReader.shared.query(
      AssistantSearchCriteria(author: .combinedCreditEquals("!!!"))
    ) {
    case .unavailable:
      preconditionFailure("author equals wildcard query unavailable")
    case .success(let page):
      precondition(page.totalCount == 0, "empty author equality must not match empty credits")
    }
  }

  static func assertAuthorCountAndPagination() {
    switch AssistantCatalogReader.shared.query(
      AssistantSearchCriteria(
        author: .combinedCreditContains("Overflow Author"),
        sort: .title,
        limit: 10,
        offset: 0
      )
    ) {
    case .unavailable:
      preconditionFailure("author query unavailable")
    case .success(let page):
      precondition(page.totalCount == 12, "expected 12 overflow books, got \(page.totalCount)")
      precondition(page.books.count == 10)
      let firstPage = page.books.map(\.libraryItemId)
      switch AssistantCatalogReader.shared.query(
        AssistantSearchCriteria(
          author: .combinedCreditContains("Overflow Author"),
          sort: .title,
          limit: 10,
          offset: 10
        )
      ) {
      case .unavailable:
        preconditionFailure("author page two unavailable")
      case .success(let second):
        precondition(second.totalCount == 12)
        precondition(second.books.count == 2)
        let overlap = Set(firstPage).intersection(second.books.map(\.libraryItemId))
        precondition(overlap.isEmpty, "pagination overlapped \(overlap)")
        let titles = (page.books + second.books).map(\.title)
        precondition(titles == titles.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending })
      }
    }

    switch AssistantCatalogReader.shared.query(
      AssistantSearchCriteria(author: .combinedCreditEquals("Stephen King"))
    ) {
    case .unavailable:
      preconditionFailure("equals query unavailable")
    case .success(let page):
      precondition(page.books.contains(where: { $0.title == "The Shining" }))
      precondition(!page.books.contains(where: { $0.author == "Stephen King and Peter Straub" }))
    }
  }

  static func assertDuplicateTitlesStayAmbiguous() {
    switch AssistantCatalogReader.shared.playbackMatch(text: "The Shining") {
    case .ambiguous(let books, let totalCount):
      precondition(books.count >= 2, "duplicate titles must stay ambiguous")
      precondition(totalCount >= 2)
      precondition(Set(books.map(\.titleNormalized)) == ["the shining"])
    default:
      preconditionFailure("expected ambiguous duplicate editions of The Shining")
    }
  }

  static func assertFourOrMoreRetained() {
    switch AssistantCatalogReader.shared.playbackMatch(text: "Overflow") {
    case .ambiguous(let books, let totalCount):
      precondition(totalCount == 12)
      precondition(books.count >= 4, "discovery must retain four or more matches")
    default:
      preconditionFailure("overflow query should stay ambiguous")
    }
  }

  static func assertAuthorCredits() {
    switch AssistantCatalogReader.shared.authors(matching: nil, limit: 25) {
    case .unavailable:
      preconditionFailure("author list unavailable")
    case .success(let credits):
      let overflow = credits.first { $0.displayName == "Overflow Author" }
      precondition(overflow?.bookCount == 12, "overflow author should have 12 books")
      let king = credits.filter { $0.normalized.contains("stephen king") }
      precondition(king.contains(where: { $0.normalized == "stephen king" }))
      precondition(king.contains(where: { $0.normalized == "stephen king and peter straub" }))
      precondition(king.count == 2, "coauthor credit must stay a separate combined credit")
    }

    switch AssistantCatalogReader.shared.authors(matching: "king", limit: 10) {
    case .unavailable:
      preconditionFailure("author match unavailable")
    case .success(let credits):
      precondition(!credits.contains(where: { $0.normalized == "overflow author" }))
      precondition(credits.contains(where: { $0.normalized == "stephen king" }))
    }

    let shiningAuthor = AssistantCatalogReader.shared.author(byID: "user-a|stephen king")
    precondition(shiningAuthor?.displayName == "Stephen King")
    precondition(AssistantCatalogReader.shared.author(byID: "user-b|stephen king") == nil)

    let one = AssistantSearchCopy.authorDialog(
      author: "Overflow Author",
      totalCount: 12,
      titles: (1...10).map { String(format: "Overflow Book %02d", $0) }
    )
    precondition(one.contains("You have 12 books by Overflow Author"))
    precondition(one.contains("There are more in your available catalog."))
    let spoken = AssistantSearchCopy.spokenTitles(["A", "B", "C", "D", "E", "F"])
    precondition(spoken == "A, B, C, D, and E")
  }

  static func assertSearchCopy() {
    precondition(
      AssistantSearchCopy.searchDialog(query: "Dune", totalCount: 0, titles: [])
        == "I couldn't find Dune in your LAABS Audio library."
    )
    precondition(
      AssistantSearchCopy.searchDialog(query: "Dune", totalCount: 1, titles: ["Dune"])
        == "I found Dune in your LAABS Audio library."
    )
    precondition(
      AssistantSearchCopy.authorDialog(author: "Frank Herbert", totalCount: 0, titles: [])
        == "I couldn't find books by Frank Herbert in your LAABS Audio library."
    )
    precondition(
      AssistantSearchCopy.authorDialog(author: "Frank Herbert", totalCount: 1, titles: ["Dune"])
        == "You have 1 book by Frank Herbert: Dune."
    )
    let many = AssistantSearchCopy.searchDialog(
      query: "Dune",
      totalCount: 2,
      titles: ["Dune", "Dune: Messiah"]
    )
    precondition(many.contains("I found 2 audiobooks matching Dune"))
  }

  static func assertWrongUserAndContract(db: OpaquePointer, dbPath: String) {
    AssistantRuntimeContextStore.shared.publish(
      AssistantRuntimeContext(
        dbPath: dbPath,
        userId: "user-b",
        accessMode: .serverBrowsing,
        canAttemptStreaming: true
      )
    )
    switch AssistantCatalogReader.shared.query(AssistantSearchCriteria(text: "Shining")) {
    case .success(let page):
      precondition(page.totalCount == 0, "user-b must not see user-a books")
    case .unavailable:
      preconditionFailure("missing user-b contract should still be a supported empty catalog")
    }

    exec(db, "UPDATE assistant_catalog_meta SET contract_version = 2 WHERE user_id = 'user-a'")
    AssistantRuntimeContextStore.shared.publish(
      AssistantRuntimeContext(
        dbPath: dbPath,
        userId: "user-a",
        accessMode: .serverBrowsing,
        canAttemptStreaming: true
      )
    )
    switch AssistantCatalogReader.shared.query(AssistantSearchCriteria(text: "Shining")) {
    case .unavailable:
      break
    case .success:
      preconditionFailure("old contract must be unavailable, not an empty success")
    }
    exec(db, "UPDATE assistant_catalog_meta SET contract_version = 1 WHERE user_id = 'user-a'")
    AssistantRuntimeContextStore.shared.publish(
      AssistantRuntimeContext(
        dbPath: dbPath,
        userId: "user-a",
        accessMode: .serverBrowsing,
        canAttemptStreaming: true
      )
    )
  }

  static func assertDownloadedSession(dbPath: String) {
    AssistantRuntimeContextStore.shared.publish(
      AssistantRuntimeContext(
        dbPath: dbPath,
        userId: "user-a",
        accessMode: .downloadedSessionOnly,
        canAttemptStreaming: false
      )
    )
    switch AssistantCatalogReader.shared.query(AssistantSearchCriteria(text: "Shining")) {
    case .unavailable:
      preconditionFailure("downloaded session query unavailable")
    case .success(let page):
      precondition(page.books.allSatisfy(\.isDownloaded))
      precondition(page.books.contains(where: { $0.title == "The Shining" }))
      precondition(!page.books.contains(where: { $0.libraryItemId == "shining-undownloaded" }))
    }
  }

  static func searchTitles(_ query: String) -> [String] {
    AssistantCatalogReader.shared.search(text: query).map(\.title)
  }

  static func openDatabase(at path: String) -> OpaquePointer {
    var db: OpaquePointer?
    let code = sqlite3_open_v2(
      path,
      &db,
      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX,
      nil
    )
    precondition(code == SQLITE_OK, "sqlite open failed \(code)")
    return db!
  }

  static func createSchema(_ db: OpaquePointer) {
    exec(
      db,
      """
      CREATE TABLE assistant_catalog (
        user_id TEXT NOT NULL,
        library_item_id TEXT NOT NULL,
        library_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        author TEXT,
        narrator TEXT,
        series_name TEXT,
        series_sequence TEXT,
        duration_seconds REAL NOT NULL DEFAULT 0,
        cover_path TEXT,
        cover_url TEXT,
        search_text TEXT NOT NULL,
        title_normalized TEXT NOT NULL,
        author_normalized TEXT NOT NULL DEFAULT '',
        series_normalized TEXT NOT NULL DEFAULT '',
        narrator_normalized TEXT NOT NULL DEFAULT '',
        progress_percent REAL NOT NULL DEFAULT 0,
        current_time_seconds REAL NOT NULL DEFAULT 0,
        is_finished INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER,
        is_downloaded INTEGER NOT NULL DEFAULT 0,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, library_item_id)
      );
      CREATE TABLE assistant_catalog_meta (
        user_id TEXT PRIMARY KEY NOT NULL,
        built_at INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        contract_version INTEGER NOT NULL
      );
      """
    )
  }

  static func seed(_ db: OpaquePointer) {
    insert(
      db,
      id: "shining-downloaded",
      title: "The Shining",
      author: "Stephen King",
      narrator: "Campbell Scott",
      downloaded: true
    )
    insert(
      db,
      id: "shining-undownloaded",
      title: "The Shining",
      author: "Stephen King",
      narrator: "Other Narrator",
      downloaded: false
    )
    insert(db, id: "dune", title: "Dune", author: "Frank Herbert")
    insert(db, id: "dune-messiah", title: "Dune: Messiah", author: "Frank Herbert")
    insert(db, id: "homogenic", title: "Homogenic", author: "Björk")
    insert(db, id: "talisman", title: "The Talisman", author: "Stephen King and Peter Straub")
    for index in 1...12 {
      insert(
        db,
        id: "overflow-\(index)",
        title: String(format: "Overflow Book %02d", index),
        author: "Overflow Author"
      )
    }
    exec(
      db,
      """
      INSERT INTO assistant_catalog_meta(user_id, built_at, row_count, contract_version)
      VALUES ('user-a', 1, 18, 1), ('user-b', 1, 0, 1);
      """
    )
  }

  static func insert(
    _ db: OpaquePointer,
    id: String,
    title: String,
    author: String,
    narrator: String = "",
    downloaded: Bool = false
  ) {
    let titleNormalized = AssistantText.normalize(title)
    let authorNormalized = AssistantText.normalize(author)
    let narratorNormalized = AssistantText.normalize(narrator)
    let searchText = AssistantText.normalize([title, author, narrator].filter { !$0.isEmpty }.joined(separator: " "))
    let sql = """
      INSERT INTO assistant_catalog (
        user_id, library_item_id, library_id, title, author, narrator, search_text,
        title_normalized, author_normalized, narrator_normalized, is_downloaded, updated_at
      ) VALUES ('user-a', ?, 'lib-1', ?, ?, ?, ?, ?, ?, ?, ?, 1)
      """
    var statement: OpaquePointer?
    sqlite3_prepare_v2(db, sql, -1, &statement, nil)
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, id, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 2, title, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 3, author, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 4, narrator, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 5, searchText, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 6, titleNormalized, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 7, authorNormalized, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_text(statement, 8, narratorNormalized, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    sqlite3_bind_int(statement, 9, downloaded ? 1 : 0)
    precondition(sqlite3_step(statement) == SQLITE_DONE, "insert failed for \(id)")
  }

  static func exec(_ db: OpaquePointer, _ sql: String) {
    var error: UnsafeMutablePointer<CChar>?
    let code = sqlite3_exec(db, sql, nil, nil, &error)
    if code != SQLITE_OK {
      let message = error.map { String(cString: $0) } ?? "unknown"
      sqlite3_free(error)
      preconditionFailure("sql failed: \(message)")
    }
  }
}
