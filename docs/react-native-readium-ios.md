# `react-native-readium` — iOS install

**Date:** 2026-09-02
**Scope:** iOS only. Android is not wired up.
**Plugin:** [`plugins/with-readium.js`](../plugins/with-readium.js), registered last in `app.json`.

The published package has no Expo config plugin. This app is CNG (`ios/` is gitignored), so every prebuild / EAS build must re-apply the CocoaPods wiring or `pod install` fails.

---

## What was installed

- `react-native-readium` `^5.1.1` ([5-stones/react-native-readium](https://github.com/5-stones/react-native-readium))
- `react-native-nitro-modules` bumped `0.33.7` → `0.35.10` to match Readium's Nitrogen-generated specs

Nitro 0.35's breaking change is Kotlin-only. MMKV 4.1.2 stays; its iOS path is Swift/C++. If Android comes back later, bump MMKV to 4.3.x in the same change.

This is native code. It does not run in Expo Go. `npx expo run:ios` (or EAS) is required.

---

## Why the Podfile needs special treatment

Readium's Swift pods (`ReadiumShared`, `ReadiumStreamer`, `ReadiumNavigator`, `ReadiumInternal`) live in a **custom spec repo**, not the CocoaPods trunk:

```ruby
source 'https://github.com/readium/podspecs'
source 'https://cdn.cocoapods.org/'
```

Without that first `source`, CocoaPods reports:

```
None of your spec sources contain a spec satisfying the dependency: `ReadiumStreamer (~> 3.11.0)`.
```

`expo run:ios` does **not** re-run config plugins when `ios/` already exists. A first install after adding the plugin needs `npx expo prebuild --platform ios` (or a clean `ios/`) so `with-readium` actually edits the Podfile.

The plugin then:

1. Requires Readium's `readium_pods` / `readium_post_install` helpers.
2. Calls `readium_pods` in the app target (adds Minizip as a direct pod).
3. In `pre_install`, calls `set_use_modular_headers_for_pod('Minizip', true)` — Expo links pods as static libraries, and `:modular_headers => true` on the pod line is not enough.
4. Calls `readium_post_install(installer)` so Minizip's modulemap survives Nitro's `SWIFT_OBJC_INTEROP_MODE=objcxx`.

Trap: do not detect "already wired" by searching for the substring `readium_pods`. The `require ... 'scripts/readium_pods'` line matches that and will skip the actual `readium_pods` call. The plugin looks for `  readium_pods\n`.

---

## Verify

```bash
npx expo prebuild --platform ios   # if ios/ predates the plugin
npx expo run:ios
```

`pod install` should resolve ReadiumStreamer / Shared / Navigator **3.11.0** and `react-native-readium` **5.1.1**. Duplicate-spec warnings for old Readium betas on trunk vs the spec repo are harmless.
