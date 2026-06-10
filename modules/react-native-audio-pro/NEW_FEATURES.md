# New Features

Date: June 7, 2026

This document isolates the newest feature additions for React Native Audio Pro. It is intended as a concise companion to the README, with deeper lock screen details available in [docs/lock-screen-seek-configuration.md](docs/lock-screen-seek-configuration.md).

## Lock Screen Remote Command Modes

`AudioPro.configure()` now supports an explicit `remoteCommandMode` option for selecting which secondary lock screen controls should appear:

```typescript
AudioPro.configure({
	remoteCommandMode: 'next-prev',
});
```

Supported values:

- `next-prev` - Shows next and previous controls for playlist or chapter-style navigation.
- `skip-intervals` - Shows skip forward and skip backward controls.
- `none` - Hides both next/previous and skip interval controls.

The older `showNextPrevControls` and `showSkipControls` options remain supported for backwards compatibility, but new code should prefer `remoteCommandMode`.

## Independent Skip Intervals

Skip controls now support separate forward and backward intervals:

```typescript
AudioPro.configure({
	remoteCommandMode: 'skip-intervals',
	skipForwardIntervalMs: 30000,
	skipBackwardIntervalMs: 10000,
});
```

This allows audiobook and podcast apps to use common asymmetric controls, such as 30 seconds forward and 10 seconds back.

`skipIntervalMs` is still supported as a shorthand for setting both directions to the same value.

## iOS Lock Screen Scrubber Control

iOS apps can now disable the lock screen and Control Center playback position scrubber:

```typescript
AudioPro.configure({
	disableLockScreenSeek: true,
});
```

When enabled, iOS disables the system playback position command and omits elapsed-time/duration metadata from Now Playing info. The metadata change is required to hide the lock screen scrubber; disabling the command alone does not remove the visible slider.

## Live Configuration Updates

`AudioPro.updateConfiguration()` has been added so apps can update configuration while playback is active:

```typescript
AudioPro.updateConfiguration({
	remoteCommandMode: 'next-prev',
	disableLockScreenSeek: true,
});
```

On iOS, this immediately reapplies lock screen command settings, including:

- `remoteCommandMode`
- `disableLockScreenSeek`
- `skipForwardIntervalMs`
- `skipBackwardIntervalMs`

On other platforms, the merged configuration is stored for the next `play()` call until native live-update support is added.

## Remote Next and Previous Events

Next and previous lock screen commands continue to emit:

- `AudioProEventType.REMOTE_NEXT`
- `AudioProEventType.REMOTE_PREV`

Apps remain responsible for deciding what those commands mean, such as moving between tracks, chapters, or playlist items.

## Backwards Compatibility

The following legacy options remain available:

- `showNextPrevControls`
- `showSkipControls`
- `skipIntervalMs`
- Deprecated `skipInterval`

If both legacy `showNextPrevControls` and `showSkipControls` are enabled, next/previous controls take priority and skip controls are disabled.

## Example

```typescript
import { AudioPro, AudioProContentType } from 'react-native-audio-pro';

AudioPro.configure({
	contentType: AudioProContentType.SPEECH,
	remoteCommandMode: 'skip-intervals',
	disableLockScreenSeek: false,
	skipForwardIntervalMs: 30000,
	skipBackwardIntervalMs: 10000,
});

AudioPro.updateConfiguration({
	remoteCommandMode: 'next-prev',
	disableLockScreenSeek: true,
});
```
