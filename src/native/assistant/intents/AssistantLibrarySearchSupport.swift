import AppIntents

enum AssistantLibrarySearchSupport {
  static func resolvedAuthor(entity: AssistantAuthorEntity) -> AssistantLibrarySearchOutcome {
    guard AssistantAccessPolicy.canAnswerReadOnly(AssistantRuntimeContextStore.shared.current())
    else {
      return .signInRequired
    }
    switch AssistantCatalogReader.shared.authors(matching: nil, limit: 1) {
    case .unavailable:
      return .unavailable
    case .libraryRequired:
      return .libraryRequired
    case .success:
      break
    }
    guard let credit = AssistantCatalogReader.shared.author(byID: entity.id) else {
      return .results(
        AssistantLibrarySearchResults(
          dialog: AssistantSearchCopy.authorDialog(author: entity.name, totalCount: 0, titles: []),
          heading: "Books by \(entity.name)",
          books: [],
          totalCount: 0,
          query: entity.name
        )
      )
    }
    return authorList(authorName: credit.displayName, exactCredit: true)
  }

  static func authorList(authorName: String, exactCredit: Bool = false) -> AssistantLibrarySearchOutcome {
    list(
      criteria: AssistantSearchCriteria(
        author: exactCredit ? .combinedCreditEquals(authorName) : .combinedCreditContains(authorName),
        sort: .title,
        limit: AssistantSearchCopy.displayedBookLimit
      ),
      dialog: { total, titles in
        AssistantSearchCopy.authorDialog(author: authorName, totalCount: total, titles: titles)
      },
      heading: { "Books by \(authorName)" },
      query: authorName
    )
  }

  static func textSearch(query: String) -> AssistantLibrarySearchOutcome {
    list(
      criteria: AssistantSearchCriteria(
        text: query,
        sort: .relevance,
        limit: AssistantSearchCopy.displayedBookLimit
      ),
      dialog: { total, titles in
        AssistantSearchCopy.searchDialog(query: query, totalCount: total, titles: titles)
      },
      heading: { "Matching audiobooks" },
      query: query
    )
  }

  private static func list(
    criteria: AssistantSearchCriteria,
    dialog: (Int, [String]) -> String,
    heading: () -> String,
    query: String
  ) -> AssistantLibrarySearchOutcome {
    guard AssistantAccessPolicy.canAnswerReadOnly(AssistantRuntimeContextStore.shared.current())
    else {
      return .signInRequired
    }
    switch AssistantCatalogReader.shared.query(criteria) {
    case .unavailable:
      return .unavailable
    case .libraryRequired:
      return .libraryRequired
    case .success(let page):
      let books = page.books.map { AssistantBookEntity(row: $0) }
      return .results(
        AssistantLibrarySearchResults(
          dialog: dialog(page.totalCount, page.books.map(\.title)),
          heading: heading(),
          books: books,
          totalCount: page.totalCount,
          query: query
        )
      )
    }
  }
}

struct AssistantLibrarySearchResults {
  var dialog: String
  var heading: String
  var books: [AssistantBookEntity]
  var totalCount: Int
  var query: String
}

enum AssistantLibrarySearchOutcome {
  case signInRequired
  case libraryRequired
  case unavailable
  case results(AssistantLibrarySearchResults)
}

extension ForegroundContinuableIntent {
  func presentLibrarySearch(
    _ outcome: AssistantLibrarySearchOutcome
  ) async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    switch outcome {
    case .signInRequired:
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      return .result(dialog: AssistantIntentSupport.failureDialog(code: "signInRequired")) {
        AssistantResultSnippet(heading: "Sign in required", books: [])
      }
    case .libraryRequired:
      try await requestToContinueInForeground(IntentDialog("\(AssistantSearchCopy.libraryRequired())"))
      return .result(dialog: "\(AssistantSearchCopy.libraryRequired())") {
        AssistantResultSnippet(heading: "Choose a library", books: [])
      }
    case .unavailable:
      return .result(dialog: "\(AssistantSearchCopy.catalogUnavailable())") {
        AssistantResultSnippet(heading: "Library unavailable", books: [])
      }
    case .results(let results):
      try await offerOpenAppSearchIfEmpty(results)
      return .result(dialog: "\(results.dialog)") {
        AssistantResultSnippet(heading: results.heading, books: results.books)
      }
    }
  }

  @available(iOS 26.0, *)
  func presentInteractiveLibrarySearch(
    _ outcome: AssistantLibrarySearchOutcome
  ) async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
    switch outcome {
    case .signInRequired:
      try await requestToContinueInForeground("Open LAABS Audio to choose a session.")
      return .result(
        dialog: AssistantIntentSupport.failureDialog(code: "signInRequired"),
        snippetIntent: AssistantLibrarySearchSnippetIntent(heading: "Sign in required", books: [])
      )
    case .libraryRequired:
      try await requestToContinueInForeground(IntentDialog("\(AssistantSearchCopy.libraryRequired())"))
      return .result(
        dialog: IntentDialog("\(AssistantSearchCopy.libraryRequired())"),
        snippetIntent: AssistantLibrarySearchSnippetIntent(heading: "Choose a library", books: [])
      )
    case .unavailable:
      return .result(
        dialog: IntentDialog("\(AssistantSearchCopy.catalogUnavailable())"),
        snippetIntent: AssistantLibrarySearchSnippetIntent(heading: "Library unavailable", books: [])
      )
    case .results(let results):
      try await offerOpenAppSearchIfEmpty(results)
      return .result(
        dialog: IntentDialog("\(results.dialog)"),
        snippetIntent: AssistantLibrarySearchSnippetIntent(
          heading: results.heading,
          books: results.books,
          totalCount: results.totalCount,
          query: results.query
        )
      )
    }
  }

  func offerOpenAppSearchIfEmpty(_ results: AssistantLibrarySearchResults) async throws {
    let query = results.query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard results.totalCount == 0, !query.isEmpty else { return }
    AssistantPendingSearch.storeSystemTerm(query)
    do {
      try await requestToContinueInForeground(IntentDialog("\(AssistantSearchCopy.openAppSearch(query: query))"))
    } catch {
      _ = AssistantPendingSearch.take()
    }
  }
}
