internal import Expo
import React
import UIKit

// Copied over Expo's template `ios/<App>/SceneDelegate.swift` by plugins/with-carplay.js on
// prebuild. Edit this file, not the generated one.

/// Owns the app's single React Native root.
///
/// Under the SDK 58 scene life cycle, Expo starts React Native when the phone window scene
/// connects. When the car cold-launches the app, only the CarPlay scene connects, yet the CarPlay
/// templates wait on shelf data pushed from JS. So the CarPlay scene starts React Native without a
/// window, and the phone scene adopts that running root when the user opens the app instead of
/// starting a second React tree.
@objc(LAABSReactRuntime)
final class LAABSReactRuntime: NSObject {
  private static var hasStarted = false
  /// A running root that is not shown in any window.
  private static var detachedRootViewController: UIViewController?

  /// Called by `CarPlaySceneDelegate` (react-native-audio-pro) by ObjC name, on the main thread.
  @objc static func startWithoutWindowIfNeeded() {
    guard !hasStarted else { return }
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      let factory = provider.reactNativeFactory,
      let delegate = factory.delegate else {
      NSLog("[CarPlay] LAABSReactRuntime: no React Native factory; JS not started")
      return
    }
    hasStarted = true

    // Same steps as RCTReactNativeFactory.startReactNative(withModuleName:in:), minus the window.
    // Use the overload without bundle/dev-menu configurations: Expo's root view factory routes
    // every overload through its React delegate, which ignores them. Passing
    // `RCTDevMenuConfiguration.default()` crashed Release builds, where it returns nil.
    let rootView = factory.rootViewFactory.view(
      withModuleName: provider.reactNativeFactoryModuleName,
      initialProperties: nil,
      launchOptions: nil
    )
    let rootViewController = delegate.createRootViewController()
    delegate.setRootView(rootView, toRootViewController: rootViewController)
    detachedRootViewController = rootViewController
    NSLog("[CarPlay] LAABSReactRuntime: started React Native without a phone window")
  }

  private static var widgetPlayTask: UIBackgroundTaskIdentifier = .invalid
  private static var widgetPlayObserver: NSObjectProtocol?
  private static var widgetPlayGeneration = 0

  /// Called by the widget's play intent (patches/expo-widgets+58.0.20.patch) by ObjC name, on the
  /// main thread, when no loaded track could resume natively. Starts JS if needed and keeps a
  /// background-launched app alive until audio starts, so the intent can return at once and the
  /// widget redraws right away instead of after playback begins.
  @objc static func startForWidgetPlayRequest() {
    startWithoutWindowIfNeeded()
    endWidgetPlayTask()
    widgetPlayGeneration += 1
    let generation = widgetPlayGeneration
    widgetPlayTask = UIApplication.shared.beginBackgroundTask(withName: "LAABSWidgetPlay") {
      endWidgetPlayTask()
    }
    widgetPlayObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("LAABSAudioPlaybackDidStart"),
      object: nil,
      queue: .main
    ) { _ in
      endWidgetPlayTask()
    }
    // Background tasks get about 30 s; give up a little earlier if audio never starts.
    DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
      if generation == widgetPlayGeneration { endWidgetPlayTask() }
    }
  }

  private static func endWidgetPlayTask() {
    if let observer = widgetPlayObserver {
      NotificationCenter.default.removeObserver(observer)
      widgetPlayObserver = nil
    }
    guard widgetPlayTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(widgetPlayTask)
    widgetPlayTask = .invalid
  }

  fileprivate static func markStarted() {
    hasStarted = true
  }

  fileprivate static func takeDetachedRootViewController() -> UIViewController? {
    defer { detachedRootViewController = nil }
    return detachedRootViewController
  }

  fileprivate static func detach(_ rootViewController: UIViewController) {
    detachedRootViewController = rootViewController
  }
}

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let rootViewController = LAABSReactRuntime.takeDetachedRootViewController() else {
      // Normal launch: Expo creates the window and starts React Native.
      LAABSReactRuntime.markStarted()
      super.scene(scene, willConnectTo: session, options: connectionOptions)
      return
    }

    // React Native is already running (started by CarPlay, or kept from a disconnected phone
    // scene): show that root rather than starting another.
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    (UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider)?.window = window
    window.rootViewController = rootViewController
    window.makeKeyAndVisible()
    NSLog("[CarPlay] SceneDelegate: adopted running React Native root into phone scene")

    // JS is already running, so links that open the phone UI go through the warm-link path.
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }
    if let shortcutItem = connectionOptions.shortcutItem {
      self.windowScene(windowScene, performActionFor: shortcutItem) { _ in }
    }
  }

  override func sceneDidDisconnect(_ scene: UIScene) {
    // The JS runtime outlives the phone scene (CarPlay may still be using it); keep its root so a
    // reconnecting phone scene adopts it.
    if let rootViewController = window?.rootViewController {
      window?.rootViewController = nil
      LAABSReactRuntime.detach(rootViewController)
    }
    super.sceneDidDisconnect(scene)
  }
}
