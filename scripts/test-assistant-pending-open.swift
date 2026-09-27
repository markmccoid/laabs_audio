// Run with:
// xcrun swiftc -swift-version 6 src/native/assistant/AssistantPendingOpen.swift \
//   scripts/test-assistant-pending-open.swift -o /tmp/laabs-assistant-open-tests
// /tmp/laabs-assistant-open-tests
import Foundation

private final class OpenNotificationCount: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func increment() {
    lock.lock()
    defer { lock.unlock() }
    value += 1
  }

  func read() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

@main
struct AssistantPendingOpenTests {
  static func main() {
    // The command-line executable has its own defaults domain, separate from the iOS app.
    let defaults = UserDefaults.standard
    let keys = ["laabs.assistant.pendingOpenRequest", "laabs.assistant.pendingOpenLibraryItemId"]
    let original = keys.map { defaults.object(forKey: $0) }
    for key in keys { defaults.removeObject(forKey: key) }
    defer {
      for (key, value) in zip(keys, original) {
        if let value { defaults.set(value, forKey: key) }
        else { defaults.removeObject(forKey: key) }
      }
    }

    let notificationCount = OpenNotificationCount()
    let observer = NotificationCenter.default.addObserver(
      forName: AssistantPendingOpen.didStore, object: nil, queue: nil
    ) { _ in
      // Also verifies that the notification is posted after saving and outside the store lock.
      precondition(AssistantPendingOpen.peekRequest() != nil)
      notificationCount.increment()
    }
    defer { NotificationCenter.default.removeObserver(observer) }

    AssistantPendingOpen.store(libraryItemId: " book-1 ")
    let first = AssistantPendingOpen.peekRequest()!
    precondition(first["libraryItemId"] == "book-1")
    precondition(AssistantPendingOpen.peekRequest() == first, "Peeking must not consume or change the request")
    AssistantPendingOpen.store(libraryItemId: "book-1")
    let second = AssistantPendingOpen.peekRequest()!
    precondition(notificationCount.read() == 2, "Each saved request must notify the running app")
    precondition(first["id"] != second["id"], "Repeated Open of the same book needs a fresh ID")
    precondition(!AssistantPendingOpen.acknowledge(requestId: first["id"]!))
    precondition(AssistantPendingOpen.peekRequest() == second, "Old acknowledgement must preserve the new request")
    precondition(AssistantPendingOpen.acknowledge(requestId: second["id"]!))
    precondition(AssistantPendingOpen.peekRequest() == nil)
    precondition(!AssistantPendingOpen.acknowledge(requestId: second["id"]!))
    print("PASS: persistence, repeated Open, stale acknowledgement, completed request cleanup")

    defaults.set(" legacy-book ", forKey: keys[1])
    let legacy = AssistantPendingOpen.peekRequest()!
    precondition(legacy["libraryItemId"] == "legacy-book")
    precondition(AssistantPendingOpen.peekRequest() == legacy)
    precondition(defaults.object(forKey: keys[1]) == nil)
    precondition(AssistantPendingOpen.acknowledge(requestId: legacy["id"]!))
    AssistantPendingOpen.store(libraryItemId: "   ")
    precondition(AssistantPendingOpen.peekRequest() == nil)
    precondition(notificationCount.read() == 2, "Empty destinations must not emit Open events")
    print("PASS: legacy destination migration and empty destination rejection")
  }
}
