import UIKit

/// Minimal phone-window scene delegate for CarPlay coexistence.
///
/// Declaring any UIApplicationSceneManifest (required for the CarPlay scene)
/// opts the whole app into the UIScene lifecycle, so the phone UI also needs a
/// scene — without one, the window Expo's AppDelegate creates in
/// didFinishLaunching is never attached to a UIWindowScene and the screen
/// stays black. This delegate does the smallest possible job: adopt that
/// already-created window into the connecting scene. React Native startup,
/// splash screen, and all Expo module hooks continue to run through the
/// classic AppDelegate path.
///
/// Referenced from Info.plist by plain ObjC name (see plugins/with-carplay.js).
@objc(PhoneSceneDelegate)
final class PhoneSceneDelegate: UIResponder, UIWindowSceneDelegate {
	var window: UIWindow?

	private func appDelegateWindow() -> UIWindow? {
		// UIApplicationDelegate.window is doubly optional through the protocol.
		UIApplication.shared.delegate?.window ?? nil
	}

	private func attachWindow(to windowScene: UIWindowScene, retriesLeft: Int) {
		if let delegateWindow = appDelegateWindow() {
			let sceneWindow: UIWindow
			if delegateWindow.windowScene === windowScene {
				sceneWindow = delegateWindow
			} else {
				sceneWindow = UIWindow(windowScene: windowScene)
				sceneWindow.rootViewController = delegateWindow.rootViewController
				sceneWindow.backgroundColor = delegateWindow.backgroundColor
				sceneWindow.tintColor = delegateWindow.tintColor
				delegateWindow.rootViewController = nil
				delegateWindow.isHidden = true
				(UIApplication.shared.delegate as AnyObject).setValue(sceneWindow, forKey: "window")
			}
			sceneWindow.frame = windowScene.coordinateSpace.bounds
			sceneWindow.makeKeyAndVisible()
			window = sceneWindow
			NSLog("[CarPlay] PhoneSceneDelegate attached AppDelegate window to phone scene")
			return
		}
		// On some launch paths the RN window may not exist yet when the scene
		// connects — retry briefly instead of failing to a black screen.
		guard retriesLeft > 0 else {
			NSLog("[CarPlay] PhoneSceneDelegate: no AppDelegate window to attach")
			return
		}
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
			self?.attachWindow(to: windowScene, retriesLeft: retriesLeft - 1)
		}
	}

	func scene(
		_ scene: UIScene,
		willConnectTo session: UISceneSession,
		options connectionOptions: UIScene.ConnectionOptions
	) {
		guard let windowScene = scene as? UIWindowScene else { return }
		attachWindow(to: windowScene, retriesLeft: 40)

		// Cold-start deep link: under the scene lifecycle the URL arrives here
		// instead of application(_:didFinishLaunchingWithOptions:) launchOptions.
		if let urlContext = connectionOptions.urlContexts.first {
			forwardURLToAppDelegate(urlContext.url)
		}
	}

	// Warm deep links (app already running) arrive here under scene lifecycle;
	// forward to the classic AppDelegate handler that Expo/RN linking hooks.
	func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
		for context in URLContexts {
			forwardURLToAppDelegate(context.url)
		}
	}

	// Universal links under scene lifecycle.
	func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
		_ = UIApplication.shared.delegate?.application?(
			UIApplication.shared,
			continue: userActivity,
			restorationHandler: { _ in }
		)
	}

	private func forwardURLToAppDelegate(_ url: URL) {
		_ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: url, options: [:])
	}
}
