package expo.modules.cliptranscriber

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClipTranscriberModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClipTranscriber")

    AsyncFunction("getClipTranscriptionAvailability") { _: Map<String, Any?> ->
      mapOf(
        "available" to false,
        "reason" to "Clip Transcription is unavailable on Android in this build",
      )
    }

    AsyncFunction("transcribeClip") { _: Map<String, Any?> ->
      throw Exception("Clip Transcription is unavailable on Android in this build")
    }

    AsyncFunction("cancelClipTranscription") { _: String ->
      Unit
    }
  }
}

