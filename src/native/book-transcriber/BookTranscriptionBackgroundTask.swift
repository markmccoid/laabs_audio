import BackgroundTasks
import Foundation
import os

/// `BGProcessingTask` plumbing for Book Transcripts
/// (`docs/transcription-background-execution-plan.md` Phase 5).
///
/// Deliberately independent of `ExpoModulesCore`: `BGTaskScheduler.register` MUST be called before
/// `application(_:didFinishLaunchingWithOptions:)` returns, and an Expo module cannot satisfy that.
/// Expo builds its `AppContext` — and with it every `ModuleHolder`, which is what fires `OnCreate` —
/// inside `EXReactNativeFactory host:didInitializeRuntime:`, i.e. **on the JS thread, after**
/// `didFinishLaunchingWithOptions` has returned. So registration lives here, is called straight from
/// the AppDelegate by `./plugins/with-transcription-background`, and `BookTranscriber` only attaches
/// to it later.
///
/// ## Scope: a live process, not a cold launch
///
/// `BGProcessingTask` can launch a **terminated** app into the background. This coordinator
/// deliberately does not use that. A window is adopted only when the JS orchestrator has already
/// declared itself ready (`setReady(true)`), which by construction cannot be true during a cold
/// launch — the AppContext that owns the JS module does not exist yet when the launch handler runs.
/// An unadopted window is rescheduled and completed immediately, which costs nothing and warms the
/// process toward the case that does work: a later window granted while the process is alive but
/// suspended.
///
/// The reason is `docs/carplay-debugging-log.md` (Attempt D): in a headless launch JS timers never
/// fire and a single missed event hangs a promise forever. Driving a multi-minute transcription
/// through that runtime is not something this codebase can currently claim.
final class BookTranscriptionBackgroundTaskCoordinator: @unchecked Sendable {
  static let shared = BookTranscriptionBackgroundTaskCoordinator()

  /// Must match `BGTaskSchedulerPermittedIdentifiers` in Info.plist (written by
  /// `./plugins/with-transcription-background`) and `TRANSCRIPTION_BACKGROUND_TASK_IDENTIFIER` in
  /// `src/transcription/transcription-background-task.ts`.
  static let taskIdentifier = "com.markmccoid.laabs-audio.transcription"

  /// How long iOS is given to hear back from JS after `expirationHandler` fires before the task is
  /// completed regardless. iOS grants seconds of grace, not minutes — being terminated for holding
  /// an expired task is worse than losing the last unflushed batch.
  private static let expirationGraceSeconds: TimeInterval = 4

  /// Default gap before the rescheduled request may run. `earliestBeginDate` is a floor, never a
  /// promise: iOS schedules these opportunistically (charging, idle, locked).
  static let defaultEarliestBeginSeconds: TimeInterval = 15 * 60

  private static let log = Logger(
    subsystem: "laabs.transcription",
    category: "BackgroundTask"
  )

  /// Everything below is touched only on the main queue. `register(using: nil)` runs the launch
  /// handler there, the Expo module hops there, and the expiration handler is delivered there.
  private var isRegistered = false
  private var isReady = false
  private var activeTask: BGProcessingTask?
  private var activeRunId: String?
  private var expirationTimer: DispatchWorkItem?

  private var onStart: ((String) -> Void)?
  private var onExpire: ((String) -> Void)?

  private init() {}

  // MARK: - Launch-time registration

  /// Call from `application(_:didFinishLaunchingWithOptions:)` and nowhere else.
  ///
  /// Registering an identifier that is missing from `BGTaskSchedulerPermittedIdentifiers` returns
  /// `false` rather than trapping, so a stale Info.plist degrades to "no background transcription"
  /// instead of a launch crash.
  @discardableResult
  static func registerLaunchHandler() -> Bool {
    shared.registerLaunchHandler()
  }

  @discardableResult
  func registerLaunchHandler() -> Bool {
    guard !isRegistered else {
      return true
    }

    let didRegister = BGTaskScheduler.shared.register(
      forTaskWithIdentifier: Self.taskIdentifier,
      using: nil
    ) { [weak self] task in
      guard let processingTask = task as? BGProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      self?.handle(processingTask)
    }

    isRegistered = didRegister
    Self.log.info("register handler identifier=\(Self.taskIdentifier, privacy: .public) ok=\(didRegister)")
    return didRegister
  }

  // MARK: - JS attachment

  /// Wired up by `BookTranscriber` once the JS controller installs itself. Until `setReady(true)`
  /// lands, every granted window is declined and rescheduled.
  func attach(
    onStart: @escaping (String) -> Void,
    onExpire: @escaping (String) -> Void
  ) {
    onMain {
      self.onStart = onStart
      self.onExpire = onExpire
    }
  }

  func detach() {
    onMain {
      self.onStart = nil
      self.onExpire = nil
      self.isReady = false
    }
  }

  func setReady(_ ready: Bool) {
    onMain {
      self.isReady = ready
    }
  }

  // MARK: - Scheduling

  /// Submit (or re-submit) the processing request. Cancels any pending one first: `submit` throws
  /// `tooManyPendingTaskRequests` for a duplicate identifier, and "reschedule" is the common call.
  ///
  /// - `requiresExternalPower`: **true** — transcription is a sustained ~25× realtime CPU job.
  /// - `requiresNetworkConnectivity`: **false** — `SpeechAnalyzer` is fully on-device.
  @discardableResult
  func schedule(earliestBeginSeconds: TimeInterval?) throws -> Bool {
    guard isRegistered else {
      return false
    }

    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)

    let request = BGProcessingTaskRequest(identifier: Self.taskIdentifier)
    request.requiresExternalPower = true
    request.requiresNetworkConnectivity = false
    request.earliestBeginDate = Date(
      timeIntervalSinceNow: max(0, earliestBeginSeconds ?? Self.defaultEarliestBeginSeconds)
    )

    try BGTaskScheduler.shared.submit(request)
    Self.log.info("scheduled earliestBegin=\(request.earliestBeginDate?.description ?? "now", privacy: .public)")
    return true
  }

  func cancelScheduled() {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
  }

  // MARK: - Window lifetime

  private func handle(_ task: BGProcessingTask) {
    onMain {
      // Only one window at a time. A previous one still open means JS never answered; let it go
      // rather than leaking it.
      self.finishActiveTask(success: false)

      let runId = UUID().uuidString
      self.activeTask = task
      self.activeRunId = runId

      task.expirationHandler = { [weak self] in
        self?.handleExpiration(runId: runId)
      }

      guard self.isReady, let onStart = self.onStart else {
        // Cold launch, or JS not up yet: decline, but leave a request behind so a later window —
        // by then with a live process — can do the work.
        Self.log.info("window declined runId=\(runId, privacy: .public) reason=js-not-ready")
        _ = try? self.schedule(earliestBeginSeconds: nil)
        self.finishActiveTask(success: false)
        return
      }

      Self.log.info("window adopted runId=\(runId, privacy: .public)")
      onStart(runId)
    }
  }

  /// iOS is out of patience. JS gets the chance to cancel the analyzer and let the pending watermark
  /// write land, but only for `expirationGraceSeconds` — then the task is completed regardless.
  private func handleExpiration(runId: String) {
    onMain {
      guard self.activeRunId == runId else {
        return
      }

      Self.log.info("window expiring runId=\(runId, privacy: .public)")
      self.onExpire?(runId)

      let forceComplete = DispatchWorkItem { [weak self] in
        guard let self, self.activeRunId == runId else {
          return
        }
        Self.log.info("window force-completed runId=\(runId, privacy: .public)")
        self.finishActiveTask(success: false)
      }
      self.expirationTimer = forceComplete
      DispatchQueue.main.asyncAfter(
        deadline: .now() + Self.expirationGraceSeconds,
        execute: forceComplete
      )
    }
  }

  /// JS reporting that the window's work is wound up. A stale `runId` is ignored, not an error —
  /// the force-complete above can beat it.
  func complete(runId: String, success: Bool) {
    onMain {
      guard self.activeRunId == runId else {
        return
      }
      Self.log.info("window completed runId=\(runId, privacy: .public) success=\(success)")
      self.finishActiveTask(success: success)
    }
  }

  private func finishActiveTask(success: Bool) {
    expirationTimer?.cancel()
    expirationTimer = nil

    guard let task = activeTask else {
      activeRunId = nil
      return
    }

    activeTask = nil
    activeRunId = nil
    task.expirationHandler = nil
    task.setTaskCompleted(success: success)
  }

  // MARK: - Helpers

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }
}
