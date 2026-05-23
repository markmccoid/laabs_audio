import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AudioTrimmer : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioTrimmer")

    AsyncFunction("trimAudio") { _: String, _: Double, _: Double ->
      throw Exception("Clip extraction is unavailable on Android in this build")
    }
  }
}
