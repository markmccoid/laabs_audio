import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BookTranscriber : Module() {
  override fun definition() = ModuleDefinition {
    Name("BookTranscriber")

    Events(
      "onSegments",
      "onFileProgress",
      "onFileFinished",
      "onModelDownloadProgress",
      "onBackgroundTaskStart",
      "onBackgroundTaskExpire",
    )

    AsyncFunction("getBookTranscriptionAvailability") { _: Map<String, Any?> ->
      mapOf(
        "available" to false,
        "reason" to "unavailable",
        "localeSupported" to false,
        "modelInstalled" to false,
      )
    }

    AsyncFunction("ensureLanguageModel") { _: Map<String, Any?> ->
      throw Exception("Book Transcription is unavailable on Android in this build")
    }

    AsyncFunction("transcribeBookFile") { _: Map<String, Any?> ->
      throw Exception("Book Transcription is unavailable on Android in this build")
    }

    AsyncFunction("cancelBookTranscription") { _: String ->
      Unit
    }

    // No UIKit background assertion to take; 0 is the "invalid identifier" sentinel.
    AsyncFunction("beginBackgroundAssertion") {
      0
    }

    AsyncFunction("endBackgroundAssertion") { _: Int ->
      Unit
    }

    // BGProcessingTask has no Android counterpart in this build; every call is an inert no-op so
    // the shared JS controller never has to branch on platform.
    AsyncFunction("setBackgroundTranscriptionReady") { _: Boolean ->
      Unit
    }

    AsyncFunction("scheduleBackgroundTranscription") { _: Map<String, Any?> ->
      false
    }

    AsyncFunction("cancelBackgroundTranscription") {
      Unit
    }

    AsyncFunction("completeBackgroundTranscriptionRun") { _: String, _: Boolean ->
      Unit
    }
  }
}
