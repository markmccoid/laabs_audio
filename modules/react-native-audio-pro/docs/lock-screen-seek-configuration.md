# Lock Screen Seek Configuration

## New functionality

`AudioPro.configure()` and `AudioPro.updateConfiguration()` now support iOS lock screen control configuration:

- `remoteCommandMode?: 'next-prev' | 'skip-intervals' | 'none'`
- `disableLockScreenSeek?: boolean`
- `skipForwardIntervalMs?: number`
- `skipBackwardIntervalMs?: number`

When `disableLockScreenSeek` is `true`, iOS disables `MPRemoteCommandCenter.shared().changePlaybackPositionCommand` and omits elapsed-time/duration metadata from `MPNowPlayingInfoCenter`. The metadata change is what hides the lock screen playback progress scrubber; disabling the command alone is not enough.

`updateConfiguration()` reapplies these settings to the active iOS remote command center, so settings changed in-app are reflected the next time the lock screen or Control Center is shown.

## JavaScript and TypeScript changes

- Added explicit `remoteCommandMode`.
- Added independent forward/backward skip intervals.
- Added `AudioPro.updateConfiguration()` for live iOS lock screen updates.
- Kept `showNextPrevControls`, `showSkipControls`, and `skipIntervalMs` as backwards-compatible options.

## iOS native changes

- Parsed remote command mode, lock screen seek, and independent intervals from native options.
- Applied the lock screen scrubber setting with command-center state:

```swift
commandCenter.changePlaybackPositionCommand.isEnabled = !settingDisableLockScreenSeek
```

- Suppressed `MPNowPlayingInfoPropertyElapsedPlaybackTime` and `MPMediaItemPropertyPlaybackDuration` while lock screen seek is disabled so iOS does not render the scrubber.
- Split remote command setup into setting application and target registration so command enabled states refresh on each `AudioPro.play()` call without registering duplicate command handlers.
- Fixed iOS skip command preferred intervals to use seconds, while seek actions still use milliseconds.

## Usage

```typescript
AudioPro.configure({
	remoteCommandMode: 'skip-intervals',
	disableLockScreenSeek: true,
	skipForwardIntervalMs: 30000,
	skipBackwardIntervalMs: 10000,
});

AudioPro.updateConfiguration({
	remoteCommandMode: 'next-prev',
});
```

Next/previous lock screen commands emit `REMOTE_NEXT` and `REMOTE_PREV`; chapter seeking remains app-owned.
