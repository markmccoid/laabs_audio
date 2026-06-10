# Ambient Audio Logic

## Overview

Ambient audio provides a minimal, isolated layer for ambient or looping audio in `react-native-audio-pro`. It is designed to **play a second audio track independently** of the main playback system — with no cross-interference, minimal API, and fully separate internal implementation.

## Key Principles

- **Fully isolated implementation**: ambient audio logic must be **completely separate** from main playback logic, both architecturally and in code organization.
  - No shared variables, player instances, or event emitters.
  - All function names, variables, and event keys must be **clearly prefixed** with `ambient`.
- **Auto-plays** immediately when `playAmbient()` is called.
- **Loops by default** unless `loop: false` is explicitly set.
- **No state tracking** — ambient audio does not track volume, progress, or playback state.
- **No volume getter**, state queries, or progress tracking.
- **All cleanup is internal** — calling `stopAmbient()` or letting playback end (if `loop: false`) tears down the player.
- **Main player has no effect** on ambient audio: `play()`, `pause()`, `stop()`, `clear()` do **not** interact with it.
- Ambient audio must stop and clean up automatically when the app is terminated.

## API

### Methods

| Method                   | Arguments                                 | Return Type | Description                                                   |
|--------------------------|-------------------------------------------|-------------|---------------------------------------------------------------|
| `ambientPlay(options)`   | `{ url: string; loop?: boolean }`         | `void`      | Plays an ambient track in loop mode by default.               |
| `ambientStop()`          | None                                      | `void`      | Stops and tears down ambient playback.                        |
| `ambientSetVolume()`     | `value: number` (0.0 to 1.0)              | `void`      | Sets the ambient track's volume. No getter.                   |

### Notes:
- `loop` defaults to `true`.
- Volume is **not tracked** — this is a direct setter that applies at the time of call.

## Events

Emitted on a **separate emitter key**: `AudioProAmbientEvent`

| Event Type               | Payload              | Description                              |
|--------------------------|----------------------|------------------------------------------|
| `AMBIENT_TRACK_ENDED`    | `{}`                 | Emitted when the ambient track ends and `loop` is `false`. |
| `AMBIENT_ERROR`          | `{ error: string }`  | Emitted on playback error. Automatically triggers internal cleanup (same behavior as stopAmbient()). |

### Listening Example

```ts
import { NativeEventEmitter, NativeModules } from 'react-native';

const ambientEmitter = new NativeEventEmitter(NativeModules.AudioPro);

ambientEmitter.addListener('AudioProAmbientEvent', (event) => {
  if (event.type === 'AMBIENT_TRACK_ENDED') {
    // handle ambient end
  }
});
```

## Example App

- One `Play Ambient` button calls `playAmbient({ url })`.
- One `Stop Ambient` button calls `stopAmbient()`.

No other UI or logic is required.

## Behavior on Track End

If `loop` is `false`, ambient playback will:

- **Automatically stop**
- **Emit `AMBIENT_TRACK_ENDED`**
- **Fully tear down and release all audio resources**

## Behavior on Playback Error

If an ambient playback error occurs, the player will:

- **Emit `AMBIENT_ERROR`**
- **Automatically stop and clean up ambient playback**
- **Release all resources associated with the ambient track**

This ensures no lingering playback continues after failure.

Note: Ambient audio should also stop and release resources when the app process is terminated. This must be implemented explicitly on Android if it does not occur by default.
