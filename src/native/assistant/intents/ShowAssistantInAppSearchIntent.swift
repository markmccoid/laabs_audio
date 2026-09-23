import AppIntents

// Installed iOS 27 SDK: `ShowInAppSearchResultsIntent` + `StringSearchCriteria` are iOS 17.2.
// `.system.search` is deprecated in 27.0 ("Use .system.searchInApp instead" → `SystemSearchInAppIntent`).
// The protocol intent is the iOS 17.4–26 fallback and is obsoleted at 27 so Siri has one handler.
// iOS 27 adopts `@AppIntent(schema: .system.searchInApp)`. Both carry only `criteria`.

@available(iOS, introduced: 17.4, obsoleted: 27.0)
struct ShowAssistantInAppSearchIntent: AppIntent, ShowInAppSearchResultsIntent {
  static var title: LocalizedStringResource = "Search in LAABS Audio"
  static var description = IntentDescription("Searches your LAABS Audio library and opens the results.")
  static var isDiscoverable = false
  static var openAppWhenRun = true
  static var searchScopes: [StringSearchScope] = [.general]

  @Parameter(title: "Criteria")
  var criteria: StringSearchCriteria

  init() {
    criteria = StringSearchCriteria(term: "")
  }

  func perform() async throws -> some IntentResult {
    AssistantPendingSearch.storeSystemTerm(criteria.term)
    return .result()
  }
}

@available(iOS 27.0, *)
@AppIntent(schema: .system.searchInApp)
struct SearchInAppSchemaIntent {
  static var title: LocalizedStringResource = "Search in LAABS Audio"
  static var isDiscoverable = false
  static var openAppWhenRun = true

  var criteria: StringSearchCriteria

  func perform() async throws -> some IntentResult {
    AssistantPendingSearch.storeSystemTerm(criteria.term)
    return .result()
  }
}

struct OpenAssistantSearchResultsIntent: AppIntent {
  static var title: LocalizedStringResource = "Show Search Results"
  static var description = IntentDescription("Opens the full LAABS Audio library search results.")
  static var isDiscoverable = false
  static var openAppWhenRun = true

  @Parameter(title: "Search")
  var query: String?

  init() {}

  init(query: String) {
    self.query = query
  }

  func perform() async throws -> some IntentResult {
    let context = AssistantRuntimeContextStore.shared.current()
    guard let query, let userId = context.userId, let libraryId = context.libraryId else {
      return .result()
    }
    AssistantPendingSearch.store(query: query, userId: userId, libraryId: libraryId)
    return .result()
  }
}
