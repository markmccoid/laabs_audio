enum AssistantPlayGate: Equatable, Sendable {
  case allowed
  case signInRequired
  case cannotStream
}
enum AssistantAccessPolicy {
  static func canAnswerReadOnly(_ context: AssistantRuntimeContext) -> Bool {
    context.userId != nil && context.dbPath != nil
  }

  static func canPlay(_ book: AssistantBookRow, _ context: AssistantRuntimeContext) -> AssistantPlayGate {
    guard let userId = context.userId, userId == book.userId else { return .signInRequired }
    if book.isDownloaded { return .allowed }
    return context.canAttemptStreaming ? .allowed : .cannotStream
  }
}
