import AppIntents
import Foundation

struct OpenAssistantBookActionIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Audiobook"
  static var description = IntentDescription("Opens an audiobook in LAABS Audio.")
  static var openAppWhenRun = true
  static var isDiscoverable = false

  @Parameter(title: "Audiobook")
  var book: AssistantBookEntity?

  init() {}

  init(book: AssistantBookEntity) {
    self.book = book
  }

  func perform() async throws -> some IntentResult {
    guard let libraryItemId = book?.libraryItemId, !libraryItemId.isEmpty else {
      return .result()
    }
    AssistantPendingOpen.store(libraryItemId: libraryItemId)
    return .result()
  }
}

@available(iOS 18.0, *)
struct OpenAssistantBookIntent: OpenIntent {
  static var title: LocalizedStringResource = "Open Audiobook"
  static var isDiscoverable = false
  static var openAppWhenRun = true

  @Parameter(title: "Audiobook")
  var target: AssistantBookEntity

  func perform() async throws -> some IntentResult & OpensIntent {
    AssistantPendingOpen.store(libraryItemId: target.libraryItemId)
    return .result(opensIntent: OpenLAABSIntent())
  }
}

@available(iOS 18.0, *)
struct OpenBooksSchemaAudiobookIntent: OpenIntent {
  static var title: LocalizedStringResource = "Open Audiobook"
  static var isDiscoverable = false
  static var openAppWhenRun = true

  @Parameter(title: "Audiobook")
  var target: AssistantBooksAudiobookEntity

  func perform() async throws -> some IntentResult & OpensIntent {
    AssistantPendingOpen.store(libraryItemId: target.libraryItemId)
    return .result(opensIntent: OpenLAABSIntent())
  }
}
