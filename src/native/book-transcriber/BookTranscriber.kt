import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BookTranscriber : Module() {
  override fun definition() = ModuleDefinition {
    Name("BookTranscriber")

    Events("onSegments", "onFileProgress", "onModelDownloadProgress")

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
  }
}
