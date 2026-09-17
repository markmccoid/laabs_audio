import AppIntents

struct OpenLAABSIntent: AppIntent {
  static var title: LocalizedStringResource = "Open LAABS Audio"
  static var description = IntentDescription("Opens LAABS Audio.")
  static var openAppWhenRun = true
  static var isDiscoverable = false

  func perform() async throws -> some IntentResult {
    .result()
  }
}
