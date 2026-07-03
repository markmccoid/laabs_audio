import CarPlay
import Foundation
import UIKit

////////////////////////////////////////////////////////////
// MARK: - Notification bridge
//
// The scene delegate is instantiated by UIKit (from the Info.plist scene
// manifest) while AudioPro is instantiated by React Native, so the two sides
// never hold references to each other. NotificationCenter is the seam:
// the coordinator posts, the AudioPro emitter instance forwards to JS.
////////////////////////////////////////////////////////////

enum CarPlayNotification {
	static let connected = Notification.Name("AudioProCarPlayConnected")
	static let disconnected = Notification.Name("AudioProCarPlayDisconnected")
	static let itemSelected = Notification.Name("AudioProCarPlayItemSelected")
	static let chapterSelected = Notification.Name("AudioProCarPlayChapterSelected")
	static let rateSelected = Notification.Name("AudioProCarPlayRateSelected")
	static let itemIdKey = "id"
}

////////////////////////////////////////////////////////////
// MARK: - Payload models (parsed from the JS bridge)
////////////////////////////////////////////////////////////

struct CarPlayBook {
	let id: String
	let title: String
	let detail: String?
	let coverUrl: String?
	let isPlaying: Bool

	init?(_ dict: [String: Any]) {
		guard let id = dict["id"] as? String, !id.isEmpty else { return nil }
		self.id = id
		self.title = (dict["title"] as? String) ?? "Untitled"
		self.detail = dict["detail"] as? String
		self.coverUrl = dict["coverUrl"] as? String
		self.isPlaying = (dict["isPlaying"] as? Bool) ?? false
	}
}

struct CarPlayShelf {
	let id: String
	let title: String
	let books: [CarPlayBook]

	init?(_ dict: [String: Any]) {
		guard let id = dict["id"] as? String, !id.isEmpty else { return nil }
		self.id = id
		self.title = (dict["title"] as? String) ?? ""
		let rawBooks = (dict["books"] as? [[String: Any]]) ?? []
		self.books = rawBooks.compactMap { CarPlayBook($0) }
	}
}

struct CarPlayChapter {
	let id: Int
	let title: String
	let isCurrent: Bool

	init?(_ dict: [String: Any]) {
		guard let id = dict["id"] as? NSNumber else { return nil }
		self.id = id.intValue
		self.title = (dict["title"] as? String) ?? "Chapter"
		self.isCurrent = (dict["isCurrent"] as? Bool) ?? false
	}
}

struct CarPlayRateOption {
	let value: Double
	let label: String
	let isCurrent: Bool

	init?(_ dict: [String: Any]) {
		guard let value = dict["value"] as? NSNumber else { return nil }
		self.value = value.doubleValue
		self.label = (dict["label"] as? String) ?? "\(value)×"
		self.isCurrent = (dict["isCurrent"] as? Bool) ?? false
	}
}

////////////////////////////////////////////////////////////
// MARK: - Artwork loading
////////////////////////////////////////////////////////////

/// Loads and caches cover images (local file:// paths or remote URLs), resized
/// for CarPlay list cells. Completion is always delivered on the main thread.
final class CarPlayArtworkLoader {
	static let shared = CarPlayArtworkLoader()
	private let cache = NSCache<NSString, UIImage>()
	private var inFlight = Set<String>()
	private init() {}

	func cachedImage(for urlString: String) -> UIImage? {
		cache.object(forKey: urlString as NSString)
	}

	func load(_ urlString: String, maxSize: CGSize, onLoaded: @escaping () -> Void) {
		if cache.object(forKey: urlString as NSString) != nil { return }
		if inFlight.contains(urlString) { return }
		guard let url = URL(string: urlString) else { return }
		inFlight.insert(urlString)

		let finish: (UIImage?) -> Void = { [weak self] image in
			DispatchQueue.main.async {
				guard let self = self else { return }
				self.inFlight.remove(urlString)
				if let image = image {
					self.cache.setObject(image, forKey: urlString as NSString)
					onLoaded()
				}
			}
		}

		DispatchQueue.global(qos: .userInitiated).async {
			let data: Data?
			if url.isFileURL {
				data = try? Data(contentsOf: url)
			} else {
				data = try? Data(contentsOf: url) // remote fetch off-main; simple + cached
			}
			guard let data = data, let raw = UIImage(data: data) else {
				finish(nil)
				return
			}
			finish(Self.resize(raw, to: maxSize))
		}
	}

	private static func resize(_ image: UIImage, to maxSize: CGSize) -> UIImage {
		guard maxSize.width > 0, maxSize.height > 0 else { return image }
		let scale = min(maxSize.width / image.size.width, maxSize.height / image.size.height, 1)
		let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
		let renderer = UIGraphicsImageRenderer(size: target)
		return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
	}
}

////////////////////////////////////////////////////////////
// MARK: - CarPlayCoordinator
////////////////////////////////////////////////////////////

/// Owns the CPInterfaceController for the lifetime of a CarPlay connection and
/// renders the shelf/chapter data last supplied from JS.
///
/// Template tree:
///   root CPListTemplate — one CPListImageRowItem per shelf (title + up to 8
///     tappable covers + chevron) → cover tap plays, row tap pushes the shelf
///   shelf CPListTemplate — one CPListItem per book (cover, title, detail,
///     now-playing indicator) → tap plays
///   CPNowPlayingTemplate — system-rendered; its Up Next button ("Chapters")
///     pushes the chapter list; chapter tap jumps and pops back.
///
/// All CPInterfaceController work happens on the main thread.
final class CarPlayCoordinator: NSObject {
	static let shared = CarPlayCoordinator()

	private(set) var isConnected = false
	private var interfaceController: CPInterfaceController?

	private var shelves: [CarPlayShelf] = []
	private var chapters: [CarPlayChapter] = []
	private var rateOptions: [CarPlayRateOption] = []
	private var rateTemplate: CPListTemplate?
	// False until JS pushes shelves at least once — distinguishes "JS still
	// booting" from "JS reported an empty library".
	private var hasReceivedShelves = false

	private let rootTemplate = CPListTemplate(title: "LAABS", sections: [])
	// The drill-down currently on the stack (if any), so data refreshes update
	// it in place instead of disturbing navigation.
	private var pushedShelfId: String?
	private var pushedShelfTemplate: CPListTemplate?
	private var chaptersTemplate: CPListTemplate?

	private let maxRowImages = 8

	private override init() {
		super.init()
	}

	////////////////////////////////////////////////////////////
	// MARK: Connection lifecycle
	////////////////////////////////////////////////////////////

	func connect(_ controller: CPInterfaceController) {
		NSLog("[CarPlay] scene connected (hasShelves=%d)", shelves.isEmpty ? 0 : 1)
		interfaceController = controller
		isConnected = true

		let nowPlaying = CPNowPlayingTemplate.shared
		nowPlaying.isAlbumArtistButtonEnabled = false
		nowPlaying.upNextTitle = "Chapters"
		nowPlaying.isUpNextButtonEnabled = !chapters.isEmpty
		nowPlaying.updateNowPlayingButtons([
			CPNowPlayingPlaybackRateButton { [weak self] _ in
				self?.pushRatePicker()
			}
		])
		nowPlaying.add(self)

		rootTemplate.updateSections(buildRootSections())
		rootTemplate.emptyViewTitleVariants = ["Loading your books…"]
		rootTemplate.emptyViewSubtitleVariants = ["Open LAABS on your phone if this persists"]
		controller.setRootTemplate(rootTemplate, animated: false, completion: nil)

		// If JS never reports in (e.g. a Debug build with no Metro reachable,
		// or a JS boot failure), replace the eternal spinner-message with an
		// actionable one so a stuck screen is diagnosable at a glance.
		DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
			guard let self = self, self.isConnected, !self.hasReceivedShelves else { return }
			NSLog("[CarPlay] no shelf data from JS 20s after connect — app JS likely not running")
			self.rootTemplate.emptyViewTitleVariants = ["LAABS couldn't load"]
			self.rootTemplate.emptyViewSubtitleVariants = [
				"Open the LAABS app on your phone, then try again"
			]
		}

		NotificationCenter.default.post(name: CarPlayNotification.connected, object: nil)
	}

	func disconnect() {
		NSLog("[CarPlay] scene disconnected")
		CPNowPlayingTemplate.shared.remove(self)
		interfaceController = nil
		isConnected = false
		pushedShelfId = nil
		pushedShelfTemplate = nil
		chaptersTemplate = nil
		rateTemplate = nil
		NotificationCenter.default.post(name: CarPlayNotification.disconnected, object: nil)
	}

	////////////////////////////////////////////////////////////
	// MARK: Data intake (called from AudioPro bridge methods)
	////////////////////////////////////////////////////////////

	func setShelves(_ rawShelves: [[String: Any]]) {
		DispatchQueue.main.async {
			self.hasReceivedShelves = true
			self.shelves = rawShelves.compactMap { CarPlayShelf($0) }
			NSLog("[CarPlay] setShelves: %d shelves", self.shelves.count)
			self.prefetchArtwork()
			self.refreshTemplates()
		}
	}

	func setChapters(_ rawChapters: [[String: Any]]) {
		DispatchQueue.main.async {
			self.chapters = rawChapters.compactMap { CarPlayChapter($0) }
			CPNowPlayingTemplate.shared.isUpNextButtonEnabled = !self.chapters.isEmpty
			if let template = self.chaptersTemplate {
				template.updateSections(self.buildChapterSections())
			}
		}
	}

	func setRates(_ rawRates: [[String: Any]]) {
		DispatchQueue.main.async {
			self.rateOptions = rawRates.compactMap { CarPlayRateOption($0) }
			if let template = self.rateTemplate {
				template.updateSections(self.buildRateSections())
			}
		}
	}

	func showAlert(_ message: String) {
		DispatchQueue.main.async {
			guard let controller = self.interfaceController else { return }
			let alert = CPAlertTemplate(
				titleVariants: [message],
				actions: [CPAlertAction(title: "OK", style: .default) { _ in
					controller.dismissTemplate(animated: true, completion: nil)
				}]
			)
			controller.presentTemplate(alert, animated: true, completion: nil)
			DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak controller] in
				if controller?.presentedTemplate === alert {
					controller?.dismissTemplate(animated: true, completion: nil)
				}
			}
		}
	}

	/// Push the system Now Playing screen (no-op if it is already on top).
	func showNowPlaying() {
		DispatchQueue.main.async {
			guard let controller = self.interfaceController else { return }
			if controller.topTemplate === CPNowPlayingTemplate.shared { return }
			controller.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
		}
	}

	////////////////////////////////////////////////////////////
	// MARK: Template building
	////////////////////////////////////////////////////////////

	private func refreshTemplates() {
		rootTemplate.updateSections(buildRootSections())
		if hasReceivedShelves && shelves.isEmpty {
			rootTemplate.emptyViewTitleVariants = ["No books yet"]
			rootTemplate.emptyViewSubtitleVariants = ["Add books in LAABS on your phone"]
		}
		// Keep an open drill-down current (it may have been reordered/emptied).
		if let shelfId = pushedShelfId, let template = pushedShelfTemplate {
			if let shelf = shelves.first(where: { $0.id == shelfId }) {
				template.updateSections(buildShelfSections(shelf))
			}
		}
	}

	private func buildRootSections() -> [CPListSection] {
		guard !shelves.isEmpty else { return [] }
		let items: [CPListTemplateItem] = shelves.map { shelf in
			let rowBooks = Array(shelf.books.prefix(maxRowImages))
			let images = rowBooks.map { coverImage(for: $0, maxSize: CPListImageRowItem.maximumImageSize) }
			let item = CPListImageRowItem(text: shelf.title, images: images)
			// Tap on an individual cover: play that book.
			item.listImageRowHandler = { [weak self] _, index, completion in
				if index < rowBooks.count {
					self?.selectBook(rowBooks[index].id)
				}
				completion()
			}
			// Tap on the row itself: open the full shelf list.
			item.handler = { [weak self] _, completion in
				self?.pushShelf(shelf.id)
				completion()
			}
			return item
		}
		return [CPListSection(items: items)]
	}

	private func buildShelfSections(_ shelf: CarPlayShelf) -> [CPListSection] {
		let cap = min(shelf.books.count, CPListTemplate.maximumItemCount)
		let items: [CPListTemplateItem] = shelf.books.prefix(cap).map { book in
			let item = CPListItem(
				text: book.title,
				detailText: book.detail,
				image: coverImage(for: book, maxSize: CPListItem.maximumImageSize)
			)
			item.isPlaying = book.isPlaying
			item.playingIndicatorLocation = .trailing
			item.handler = { [weak self] _, completion in
				self?.selectBook(book.id)
				completion()
			}
			return item
		}
		return [CPListSection(items: items)]
	}

	private func pushRatePicker() {
		DispatchQueue.main.async {
			guard let controller = self.interfaceController, !self.rateOptions.isEmpty else { return }
			let template = CPListTemplate(title: "Speed", sections: self.buildRateSections())
			self.rateTemplate = template
			controller.pushTemplate(template, animated: true, completion: nil)
		}
	}

	private func buildRateSections() -> [CPListSection] {
		let checkmark = UIImage(systemName: "checkmark.circle.fill")
		let items: [CPListTemplateItem] = rateOptions.map { option in
			let item = CPListItem(
				text: option.label,
				detailText: nil,
				image: option.isCurrent ? checkmark : nil
			)
			item.handler = { [weak self] _, completion in
				NotificationCenter.default.post(
					name: CarPlayNotification.rateSelected,
					object: nil,
					userInfo: [CarPlayNotification.itemIdKey: option.value]
				)
				// Return to Now Playing after choosing a speed.
				self?.interfaceController?.popTemplate(animated: true, completion: nil)
				completion()
			}
			return item
		}
		return [CPListSection(items: items)]
	}

	private func buildChapterSections() -> [CPListSection] {
		let items: [CPListTemplateItem] = chapters.map { chapter in
			let item = CPListItem(text: chapter.title, detailText: nil)
			item.isPlaying = chapter.isCurrent
			item.playingIndicatorLocation = .trailing
			item.handler = { [weak self] _, completion in
				NotificationCenter.default.post(
					name: CarPlayNotification.chapterSelected,
					object: nil,
					userInfo: [CarPlayNotification.itemIdKey: chapter.id]
				)
				// Return to Now Playing after choosing a chapter.
				self?.interfaceController?.popTemplate(animated: true, completion: nil)
				completion()
			}
			return item
		}
		return [CPListSection(items: items)]
	}

	////////////////////////////////////////////////////////////
	// MARK: Actions
	////////////////////////////////////////////////////////////

	private func selectBook(_ bookId: String) {
		NSLog("[CarPlay] book selected: %@", bookId)
		NotificationCenter.default.post(
			name: CarPlayNotification.itemSelected,
			object: nil,
			userInfo: [CarPlayNotification.itemIdKey: bookId]
		)
		showNowPlaying()
	}

	private func pushShelf(_ shelfId: String) {
		guard let controller = interfaceController,
			  let shelf = shelves.first(where: { $0.id == shelfId }) else { return }
		let template = CPListTemplate(title: shelf.title, sections: buildShelfSections(shelf))
		pushedShelfId = shelfId
		pushedShelfTemplate = template
		controller.pushTemplate(template, animated: true, completion: nil)
	}

	////////////////////////////////////////////////////////////
	// MARK: Artwork
	////////////////////////////////////////////////////////////

	private func coverImage(for book: CarPlayBook, maxSize: CGSize) -> UIImage {
		if let coverUrl = book.coverUrl,
		   let cached = CarPlayArtworkLoader.shared.cachedImage(for: coverUrl) {
			return cached
		}
		return placeholderImage(maxSize: maxSize)
	}

	private func prefetchArtwork() {
		let size = CPListImageRowItem.maximumImageSize
		var needsRefreshScheduled = false
		for shelf in shelves {
			for book in shelf.books {
				guard let coverUrl = book.coverUrl else { continue }
				if CarPlayArtworkLoader.shared.cachedImage(for: coverUrl) != nil { continue }
				CarPlayArtworkLoader.shared.load(coverUrl, maxSize: size) { [weak self] in
					guard let self = self, !needsRefreshScheduled else { return }
					needsRefreshScheduled = true
					// Coalesce: rebuild once shortly after loads start landing.
					DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
						needsRefreshScheduled = false
						self.refreshTemplates()
					}
				}
			}
		}
	}

	private func placeholderImage(maxSize: CGSize) -> UIImage {
		let side = min(max(40, maxSize.height), maxSize.width > 0 ? maxSize.width : maxSize.height)
		let size = CGSize(width: side, height: side)
		let renderer = UIGraphicsImageRenderer(size: size)
		return renderer.image { context in
			UIColor.darkGray.setFill()
			context.fill(CGRect(origin: .zero, size: size))
			if let glyph = UIImage(systemName: "book.closed.fill") {
				let inset = side * 0.25
				glyph.withTintColor(.lightGray, renderingMode: .alwaysOriginal)
					.draw(in: CGRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2))
			}
		}
	}
}

////////////////////////////////////////////////////////////
// MARK: - Now Playing template observer
////////////////////////////////////////////////////////////

extension CarPlayCoordinator: CPNowPlayingTemplateObserver {
	func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
		DispatchQueue.main.async {
			guard let controller = self.interfaceController, !self.chapters.isEmpty else { return }
			let template = CPListTemplate(title: "Chapters", sections: self.buildChapterSections())
			self.chaptersTemplate = template
			controller.pushTemplate(template, animated: true, completion: nil)
		}
	}
}

////////////////////////////////////////////////////////////
// MARK: - CarPlaySceneDelegate
////////////////////////////////////////////////////////////

/// Referenced by plain ObjC name from Info.plist
/// (UISceneDelegateClassName = "CarPlaySceneDelegate" — the @objc attribute
/// keeps the runtime name free of the Swift module prefix).
@objc(CarPlaySceneDelegate)
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
	func templateApplicationScene(
		_ templateApplicationScene: CPTemplateApplicationScene,
		didConnect interfaceController: CPInterfaceController
	) {
		CarPlayCoordinator.shared.connect(interfaceController)
	}

	func templateApplicationScene(
		_ templateApplicationScene: CPTemplateApplicationScene,
		didDisconnect interfaceController: CPInterfaceController
	) {
		CarPlayCoordinator.shared.disconnect()
	}
}
