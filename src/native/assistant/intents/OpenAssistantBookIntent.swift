import AppIntents
import Foundation

@available(iOS 18.0, *)
struct OpenAssistantBookIntent: OpenIntent {
  static var title: LocalizedStringResource = "Open Audiobook"
  static var isDiscoverable = false

  @Parameter(title: "Audiobook")
  var target: AssistantBookEntity

  func perform() async throws -> some IntentResult & OpensIntent {
    let encodedID = target.libraryItemId.addingPercentEncoding(
      withAllowedCharacters: .urlPathAllowed
    ) ?? target.libraryItemId
    let url = URL(string: "laabsaudio:///\(encodedID)")!
    return .result(opensIntent: OpenURLIntent(url))
  }
}
