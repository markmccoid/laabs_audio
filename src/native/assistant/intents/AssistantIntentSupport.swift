import AppIntents
import Foundation

struct AssistantSpokenFailure: Error, CustomLocalizedStringResourceConvertible {
  var localizedStringResource: LocalizedStringResource

  init(_ message: String) {
    localizedStringResource = "\(message)"
  }
}

enum AssistantIntentSupport {
  static func failureMessage(code: String) -> String {
    switch code {
    case "nothingPlaying":
      return "Nothing is playing in LAABS Audio."
    case "signInRequired":
      return "Sign in to LAABS Audio first."
    case "cannotStream":
      return "That book isn't downloaded and you're offline."
    case "notFound":
      return "I couldn't find that audiobook in your LAABS Audio library."
    case "timeout":
      return "LAABS Audio couldn't start playback in time. Open the app to continue."
    case "busy":
      return "LAABS Audio is already handling another request."
    default:
      return "LAABS Audio couldn't complete that request."
    }
  }

  static func failureDialog(code: String) -> IntentDialog {
    "\(failureMessage(code: code))"
  }

  static func finishPlaybackCommand(_ outcome: AssistantActionOutcome) throws -> some IntentResult {
    switch outcome {
    case .playback, .paused:
      return .result()
    case .failure(let code, _):
      throw AssistantSpokenFailure(failureMessage(code: code))
    default:
      throw AssistantSpokenFailure("LAABS Audio couldn't complete that request.")
    }
  }

  static func failureHeading(code: String) -> String {
    switch code {
    case "nothingPlaying": return "Nothing is playing"
    case "signInRequired": return "Sign in required"
    case "cannotStream": return "Download required"
    case "notFound": return "Audiobook not found"
    case "timeout": return "Request timed out"
    case "busy": return "LAABS Audio is busy"
    default: return "Request failed"
    }
  }

  static func clock(_ seconds: Double) -> String {
    let total = max(Int(seconds.rounded(.down)), 0)
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let remainder = total % 60
    return hours > 0
      ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
      : String(format: "%d:%02d", minutes, remainder)
  }
}
