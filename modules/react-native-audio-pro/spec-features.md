# 📦 Feature Specification: Audio Pro Core Capabilities

This document outlines the high-level feature set of the `react-native-audio-pro` library.
For event/state flow, see `spec-events.md`.
For ambient/secondary playback, see `spec-ambient.md`.

## ✅ Supported Audio Sources

- ✅ Static remote URLs (e.g., `https://example.com/audio.mp3`)
- ✅ Locally downloaded file paths (e.g., `/data/user/0/com.app/files/foo.mp3`)
  - TS layer automatically prefixes with `file://` if not already present.

## 🔊 Playback Features

- ✅ Full playback control: `play`, `pause`, `resume`, `seek`, `stop`, `clear`
- ✅ Audio routing & background playback
- ✅ Lock screen + media session integration (Android/iOS)
- ✅ Native volume control (0.0–1.0 range, does not affect system volume)
- ✅ Native playback speed control (0.25x to 2.0x)
- ✅ Reactive state & position updates via hook (`useAudioPro`) and event listener
- ✅ Fine-grained progress update interval (100ms to 10,000ms, default 1000ms)
- ✅ Global configuration (e.g., content type: MUSIC vs SPEECH)

## ⚠️ Not Supported (for now)

- ❌ Queues, playlists, or automatic track management
- ❌ Gapless playback (future roadmap)

## 🧪 Debugging + Development Features

- `debug`: verbose native + JS logs
- `debugIncludesProgress`: include PROGRESS events in debug logs
- `getError()`: fetch last error state

## 🧩 Design Principles

- Native owns state — JS does not emit or derive player state
- Event-driven architecture with minimal shared state
- Code is organized by domain: main player, ambient playback, hook layer
- Local path handling is abstracted in TS (e.g., adds `file://` where needed)
- Ambient playback is an optional, independent feature for looping secondary audio

## 🗂 See Also

- [spec-events.md](./spec-events.md)
- [spec-ambient.md](./spec-ambient.md)
