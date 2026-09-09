internal import ExpoModulesCore
import UIKit

/// Text and highlight geometry share one TextKit layout. In particular, this
/// does not estimate word widths or put individual words in wrapping Views.
class ReadAlongText: Module {
  func definition() -> ModuleDefinition {
    Name("ReadAlongText")
    View(ReadAlongTextView.self) {
      Events("onContentSize")
      Prop("contentId") { (view, value: String) in view.contentId = value }
      Prop("text") { (view, value: String) in view.text = value }
      Prop("fontSize") { (view, value: Double) in view.fontSize = value }
      Prop("lineHeight") { (view, value: Double) in view.lineHeight = value }
      Prop("textColor") { (view, value: UIColor) in view.textColor = value }
      Prop("wordColor") { (view, value: UIColor?) in view.wordColor = value }
      Prop("highlightColor") { (view, value: UIColor?) in view.highlightColor = value }
      Prop("boldWord") { (view, value: Bool) in view.boldWord = value }
      Prop("wordRanges") { (view, value: [[Int]]) in view.wordRanges = value }
      Prop("activeWordIndex") { (view, value: Int) in view.activeWordIndex = value }
      Prop("highlightWordCount") { (view, value: Int) in view.highlightWordCount = value }
      Prop("playbackRate") { (view, value: Double) in view.playbackRate = value }
      OnViewDidUpdateProps { (view: ReadAlongTextView) in view.applyChanges() }
    }
  }
}

private final class ReadAlongTextCanvas: UIView {
  let storage = NSTextStorage()
  let manager = NSLayoutManager()
  let container = NSTextContainer(size: .zero)

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    container.lineFragmentPadding = 0
    manager.usesFontLeading = false
    manager.addTextContainer(container)
    storage.addLayoutManager(manager)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func draw(_ rect: CGRect) {
    let range = manager.glyphRange(for: container)
    manager.drawGlyphs(forGlyphRange: range, at: .zero)
  }
}

final class ReadAlongTextView: ExpoView {
  // A fast transition across row boundaries must not accumulate one fading
  // word per row. Views do not retain one another or extend any animation.
  private static weak var outgoingOwner: ReadAlongTextView?
  let onContentSize = EventDispatcher()
  var contentId = ""
  var text = ""
  var fontSize = 18.0
  var lineHeight = 27.0
  var textColor = UIColor.label
  var wordColor: UIColor?
  var highlightColor: UIColor?
  var boldWord = false
  var wordRanges: [[Int]] = []
  var activeWordIndex = -1
  var highlightWordCount = 0
  var playbackRate = 1.0

  private let canvas = ReadAlongTextCanvas(frame: .zero)
  private let currentBackdrop = CAShapeLayer()
  private let outgoingBackdrop = CAShapeLayer()
  private var previousContentId = ""
  private var previousRanges: [[Int]] = []
  private var previousIndex = -1
  private var previousHighlightWordCount = 0
  private var previousHighlightColor: UIColor?
  private var lastWidth: CGFloat = -1
  private var lastReportedHeight: CGFloat = -1
  private var lastReportedContentId = ""
  private var appliedFontSize = 0.0
  private var appliedLineHeight = 0.0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isAccessibilityElement = false // The enclosing Pressable owns the prose label.
    accessibilityElementsHidden = true
    layer.addSublayer(outgoingBackdrop)
    layer.addSublayer(currentBackdrop)
    addSubview(canvas) // Glyphs always sit above both backgrounds.
    NotificationCenter.default.addObserver(
      self, selector: #selector(reduceMotionChanged),
      name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil
    )
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  @objc private func reduceMotionChanged() {
    if UIAccessibility.isReduceMotionEnabled { clearOutgoing() }
  }

  private func validRange(at index: Int) -> NSRange? {
    guard wordRanges.indices.contains(index), wordRanges[index].count == 2 else { return nil }
    let start = wordRanges[index][0]
    let length = wordRanges[index][1]
    let count = (text as NSString).length
    guard start >= 0, length > 0, start <= count, length <= count - start else { return nil }
    return NSRange(location: start, length: length)
  }

  private func validWindowRange(startingAt index: Int, count: Int) -> NSRange? {
    guard count > 0, let first = validRange(at: index) else { return nil }
    let lastIndex = min(index + count - 1, wordRanges.count - 1)
    guard let last = validRange(at: lastIndex) else { return nil }
    return NSRange(location: first.location, length: NSMaxRange(last) - first.location)
  }

  func applyChanges() {
    let contentChanged = previousContentId != contentId || canvas.storage.string != text
    let metricsChanged = appliedFontSize != fontSize || appliedLineHeight != lineHeight
    let paletteChanged = previousHighlightColor != highlightColor
    let rangesChanged = previousRanges != wordRanges
    let nextIndex = validRange(at: activeWordIndex) == nil ? -1 : activeWordIndex
    let reset = contentChanged || metricsChanged || paletteChanged ||
      UIAccessibility.isReduceMotionEnabled ||
      (rangesChanged && nextIndex >= 0 && previousIndex >= 0)

    switch ReadAlongHighlightTransition.resolve(
      previous: previousIndex,
      current: nextIndex,
      forwardStep: previousHighlightWordCount,
      reset: reset
    ) {
    case .keep: break
    case .clearOutgoing: clearOutgoing()
    case .replaceOutgoing: fadeCurrentBackdrop()
    }

    let font = UIFont.systemFont(ofSize: max(1, fontSize))
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = max(1, lineHeight)
    paragraph.maximumLineHeight = max(1, lineHeight)
    paragraph.alignment = .natural
    let attributed = NSMutableAttributedString(string: text, attributes: [
      .font: font,
      .foregroundColor: textColor,
      .paragraphStyle: paragraph,
      .baselineOffset: max(0, (lineHeight - font.lineHeight) / 2),
    ])
    if let range = validWindowRange(startingAt: nextIndex, count: highlightWordCount) {
      if let wordColor { attributed.addAttribute(.foregroundColor, value: wordColor, range: range) }
      if boldWord {
        attributed.addAttribute(.font, value: UIFont.systemFont(ofSize: max(1, fontSize), weight: .semibold), range: range)
      }
    }
    // Background-only transitions never invalidate text shaping or redraw ink.
    if !canvas.storage.isEqual(to: attributed) {
      canvas.storage.setAttributedString(attributed)
      canvas.setNeedsDisplay()
    }
    previousContentId = contentId
    previousRanges = wordRanges
    previousIndex = nextIndex
    previousHighlightWordCount = highlightWordCount
    previousHighlightColor = highlightColor
    appliedFontSize = fontSize
    appliedLineHeight = lineHeight
    updateLayoutAndHighlight()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    if bounds.width != lastWidth {
      lastWidth = bounds.width
      clearOutgoing() // Old line geometry must never survive a width change.
      canvas.container.size = CGSize(width: max(0, bounds.width), height: .greatestFiniteMagnitude)
      canvas.setNeedsDisplay()
    }
    updateLayoutAndHighlight()
  }

  private func updateLayoutAndHighlight() {
    guard bounds.width > 0 else { return }
    // Props can arrive before UIKit lays out a newly sized native view. Never
    // measure a paragraph against the previous (or initial zero) width.
    guard canvas.container.size.width == bounds.width else {
      setNeedsLayout()
      return
    }
    canvas.manager.ensureLayout(for: canvas.container)
    let height = ceil(max(lineHeight, canvas.manager.usedRect(for: canvas.container).maxY))
    if height != lastReportedHeight || contentId != lastReportedContentId {
      lastReportedHeight = height
      lastReportedContentId = contentId
      onContentSize(["contentId": contentId, "height": height, "width": bounds.width])
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    currentBackdrop.path = highlightColor == nil
      ? nil
      : backdropPath(startingAt: previousIndex, count: highlightWordCount)
    currentBackdrop.fillColor = highlightColor?.cgColor
    currentBackdrop.opacity = 1 // Prompt onset; only the outgoing background fades.
    CATransaction.commit()
  }

  private func backdropPath(startingAt index: Int, count: Int) -> CGPath? {
    guard let characters = validWindowRange(startingAt: index, count: count) else { return nil }
    let glyphs = canvas.manager.glyphRange(forCharacterRange: characters, actualCharacterRange: nil)
    let path = UIBezierPath()
    // Enumerating enclosing rectangles handles wrapped tokens, RTL, and mixed
    // direction prose; no rectangle stretches over the blank remainder of a line.
    canvas.manager.enumerateEnclosingRects(
      forGlyphRange: glyphs, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
      in: canvas.container
    ) { rect, _ in
      let verticalInset = max(0, (rect.height - self.fontSize * 1.2) / 2)
      let inkBackdrop = rect.insetBy(dx: -1, dy: verticalInset)
      path.append(UIBezierPath(roundedRect: inkBackdrop, cornerRadius: min(5, self.fontSize * 0.22)))
    }
    return path.isEmpty ? nil : path.cgPath
  }

  private func fadeCurrentBackdrop() {
    clearOutgoing()
    guard let path = currentBackdrop.path, !UIAccessibility.isReduceMotionEnabled else { return }
    Self.outgoingOwner?.clearOutgoing()
    Self.outgoingOwner = self
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    outgoingBackdrop.path = path
    outgoingBackdrop.fillColor = currentBackdrop.fillColor
    outgoingBackdrop.opacity = 0
    CATransaction.commit()
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.duration = ReadAlongHighlightTransition.fadeDuration(rate: playbackRate)
    fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
    outgoingBackdrop.add(fade, forKey: "wordExit")
  }

  private func clearOutgoing() {
    if Self.outgoingOwner === self { Self.outgoingOwner = nil }
    outgoingBackdrop.removeAllAnimations()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    outgoingBackdrop.opacity = 0
    outgoingBackdrop.path = nil
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { clearOutgoing() }
  }
}
