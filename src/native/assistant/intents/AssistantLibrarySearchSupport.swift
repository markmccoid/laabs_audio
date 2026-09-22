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
    case .success:
      break
    }
    guard let credit = AssistantCatalogReader.shared.author(byID: entity.id) else {
      return .results(
        dialog: AssistantSearchCopy.authorDialog(author: entity.name, totalCount: 0, titles: []),
        heading: "Books by \(entity.name)",
        books: []
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
      heading: { "Books by \(authorName)" }
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
      heading: { "Matching audiobooks" }
    )
  }

  private static func list(
    criteria: AssistantSearchCriteria,
    dialog: (Int, [String]) -> String,
    heading: () -> String
  ) -> AssistantLibrarySearchOutcome {
    guard AssistantAccessPolicy.canAnswerReadOnly(AssistantRuntimeContextStore.shared.current())
    else {
      return .signInRequired
    }
    switch AssistantCatalogReader.shared.query(criteria) {
    case .unavailable:
      return .unavailable
    case .success(let page):
      let books = page.books.map { AssistantBookEntity(row: $0) }
      return .results(
        dialog: dialog(page.totalCount, page.books.map(\.title)),
        heading: heading(),
        books: books
      )
    }
  }
}

enum AssistantLibrarySearchOutcome {
  case signInRequired
  case unavailable
  case results(dialog: String, heading: String, books: [AssistantBookEntity])
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
    case .unavailable:
      return .result(dialog: "\(AssistantSearchCopy.catalogUnavailable())") {
        AssistantResultSnippet(heading: "Library unavailable", books: [])
      }
    case .results(let dialog, let heading, let books):
      return .result(dialog: "\(dialog)") {
        AssistantResultSnippet(heading: heading, books: books)
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
    case .unavailable:
      return .result(
        dialog: IntentDialog("\(AssistantSearchCopy.catalogUnavailable())"),
        snippetIntent: AssistantLibrarySearchSnippetIntent(heading: "Library unavailable", books: [])
      )
    case .results(let dialog, let heading, let books):
      return .result(
        dialog: IntentDialog("\(dialog)"),
        snippetIntent: AssistantLibrarySearchSnippetIntent(heading: heading, books: books)
      )
    }
  }
}
