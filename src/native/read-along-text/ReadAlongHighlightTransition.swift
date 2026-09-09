import Foundation

/// Only the outgoing backdrop animates. Never queue trails or animate a seek
/// through intervening words. Kept independent of UIKit for executable tests.
enum ReadAlongHighlightTransition: Equatable {
  case keep
  case replaceOutgoing
  case clearOutgoing

  static func resolve(previous: Int, current: Int, forwardStep: Int = 1, reset: Bool) -> Self {
    if reset { return .clearOutgoing }
    if previous == current || previous < 0 { return .keep }
    if current < 0 || current == previous + max(1, forwardStep) { return .replaceOutgoing }
    return .clearOutgoing
  }

  static func fadeDuration(rate: Double) -> Double {
    let safeRate = rate.isFinite && rate > 0 ? rate : 1
    return min(0.1, 0.1 / safeRate)
  }
}
