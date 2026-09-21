import Foundation
import OSLog

enum AssistantDiagnosticName: String {
  case bookByEntityID = "catalog.bookByEntityID"
  case bookByLibraryItemID = "catalog.bookByLibraryItemID"
  case search = "catalog.search"
  case query = "catalog.query"
  case booksByAuthor = "catalog.booksByAuthor"
  case authors = "catalog.authors"
  case suggested = "catalog.suggested"
  case all = "catalog.all"
  case mostRecent = "catalog.mostRecent"
}

enum AssistantDiagnosticInputKind: String {
  case entityIdentifier
  case libraryItemIdentifier
  case freeText
  case authorText
  case none
}

enum AssistantDiagnosticOutcome: String {
  case success
  case empty
  case invalidInput
  case unavailable
}

struct AssistantDiagnosticRequest {
  fileprivate let id = UUID()
  fileprivate let name: AssistantDiagnosticName
  fileprivate let inputKind: AssistantDiagnosticInputKind
  fileprivate let startedAt = ProcessInfo.processInfo.systemUptime

  func complete(resultCount: Int, outcome: AssistantDiagnosticOutcome) {
    AssistantDiagnostics.complete(self, resultCount: resultCount, outcome: outcome)
  }
}

enum AssistantDiagnostics {
  #if DEBUG
  private static let logger = Logger(
    subsystem: "com.markmccoid.laabs-audio",
    category: "assistant-diagnostics"
  )
  #endif

  static func begin(
    _ name: AssistantDiagnosticName,
    inputKind: AssistantDiagnosticInputKind
  ) -> AssistantDiagnosticRequest {
    AssistantDiagnosticRequest(name: name, inputKind: inputKind)
  }

  fileprivate static func complete(
    _ request: AssistantDiagnosticRequest,
    resultCount: Int,
    outcome: AssistantDiagnosticOutcome
  ) {
    #if DEBUG
    let durationMilliseconds = max(
      0,
      Int(((ProcessInfo.processInfo.systemUptime - request.startedAt) * 1_000).rounded())
    )
    logger.debug(
      """
      request_id=\(request.id.uuidString, privacy: .public) \
      name=\(request.name.rawValue, privacy: .public) \
      input_kind=\(request.inputKind.rawValue, privacy: .public) \
      result_count=\(max(0, resultCount), privacy: .public) \
      duration_ms=\(durationMilliseconds, privacy: .public) \
      outcome=\(outcome.rawValue, privacy: .public)
      """
    )
    #endif
  }
}
