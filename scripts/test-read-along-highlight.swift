// Run from the repository root:
// swiftc src/native/read-along-text/ReadAlongHighlightTransition.swift scripts/test-read-along-highlight.swift -o /tmp/test-read-along-highlight
// /tmp/test-read-along-highlight
import Foundation

@main
struct ReadAlongHighlightTests {
  static func main() {
    typealias Transition = ReadAlongHighlightTransition
    assert(Transition.resolve(previous: 2, current: 3, reset: false) == .replaceOutgoing)
    assert(Transition.resolve(previous: 0, current: 3, forwardStep: 3, reset: false) == .replaceOutgoing)
    assert(Transition.resolve(previous: 3, current: 6, forwardStep: 3, reset: false) == .replaceOutgoing)
    assert(Transition.resolve(previous: 2, current: -1, reset: false) == .replaceOutgoing)
    // Entering a word after a timestamp gap must not restart the outgoing fade.
    assert(Transition.resolve(previous: -1, current: 3, reset: false) == .keep)
    assert(Transition.resolve(previous: 3, current: 3, reset: false) == .keep)
    // Seek/backtracking clears the trail instead of animating words not heard.
    assert(Transition.resolve(previous: 3, current: 2, reset: false) == .clearOutgoing)
    assert(Transition.resolve(previous: 3, current: 8, reset: false) == .clearOutgoing)
    assert(Transition.resolve(previous: 0, current: 6, forwardStep: 3, reset: false) == .clearOutgoing)
    // Recycled content, geometry/style changes, and reduced motion clear it too.
    assert(Transition.resolve(previous: 2, current: 3, reset: true) == .clearOutgoing)
    assert(Transition.resolve(previous: -1, current: -1, reset: true) == .clearOutgoing)
    assert(Transition.fadeDuration(rate: 1) == 0.1)
    assert(Transition.fadeDuration(rate: 2) == 0.05)
    assert(Transition.fadeDuration(rate: 0.5) == 0.1)
    assert(Transition.fadeDuration(rate: .nan) == 0.1)
    assert(Transition.fadeDuration(rate: 0) == 0.1)
    assert(Transition.fadeDuration(rate: -1) == 0.1)
    print("Read-Along native highlight transition tests passed (17 assertions).")
  }
}
