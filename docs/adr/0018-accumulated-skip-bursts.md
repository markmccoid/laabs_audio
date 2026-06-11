# Accumulated Skip Bursts

LAABS Audio treats repeated skip interval commands as a single accumulated Skip Burst that updates the Displayed Listening Position immediately, then applies one bounded Listening Position change to the audio engine after the burst settles. This protects the native audio engine from rapid overlapping seeks while preserving the user's full skip intent.

**Considered Options**

- Ignore additional skip commands while a seek is active.
- Queue every skip command as a separate seek.
- Keep only the latest skip target while a seek is active.
- Accumulate skip commands into a Skip Burst and apply the final target.

**Consequences**

- Skip input must be coordinated below individual control surfaces so in-app and system playback controls follow the same behavior.
- A Skip Burst must not become a Playback Control Intent because it changes Listening Position, not Audible Playback State.
- The Displayed Listening Position may temporarily lead the audio engine while the Skip Burst settles.
