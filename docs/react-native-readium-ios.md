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

## The `onTap` patch

`patches/react-native-readium+5.1.1.patch` adds a tap event the upstream binding does not have. EPUB
Read-Along's tap-to-seek depends on it — see "Tap-to-seek" in
[epub-read-along.md](./epub-read-along.md) for why decorations could not do the job.

**What it adds.** A `TapEvent { href, charOffset, totalChars, text }` and an `onTap` prop. Readium
already routes taps to `VisualNavigatorDelegate`, but the binding's `EPUBViewController` conformed to
`EPUBNavigatorDelegate` with an *empty* extension, so every tap was silently taking the protocol's
default no-op. The patch implements `navigator(_:didTapAt:)`, and resolves the point to a character
offset by running `caretRangeFromPoint` inside the document.

**It uses only public Readium API** — `EPUBNavigatorViewController.evaluateJavaScript(_:)` and the
delegate. It does *not* reach into the pod's internals, and in particular it does not try to intercept
`WKScriptMessageHandler`: Readium's `registerJSMessage` is internal to the pod and unreachable from
the binding, so the JS channel here is pull-based (evaluate on tap) rather than push-based.

**The generated files are a graft, not a regeneration.** Nitrogen must run to add a prop to the spec,
but the published `nitrogen/generated` was built with an older nitrogen than the 0.35.10 matching our
`react-native-nitro-modules`, and regenerating wholesale rewrites **1206 lines** of bridge code that
currently builds. So the patch was made by generating twice — once without the change, once with —
diffing those two, and applying only that delta onto the published files. The patch touches 24
generated files and no version churn. **If you ever need to redo this, do it the same way**; a plain
`npx nitrogen` will produce a patch an order of magnitude larger and largely unrelated to the change.

**`lib/` matters here, unlike at runtime.** Metro loads this package from `src/` (`"react-native":
"src/index"`), but `tsc` reads `lib/src/index.d.ts` (`"types"`). So the patch edits *both*: `src/` for
what runs, `lib/**/*.d.ts` for what typechecks. Editing only one produces a build that works and does
not compile, or the reverse.

**New generated files mean `pod install`.** The patch adds eight files to `nitrogen/generated`, which
CocoaPods has to add to the Pods project. `patch-package` alone is not enough after a fresh install.

---

## Verify

```bash
npx expo prebuild --platform ios   # if ios/ predates the plugin
npx expo run:ios
```

`pod install` should resolve ReadiumStreamer / Shared / Navigator **3.11.0** and `react-native-readium` **5.1.1**. Duplicate-spec warnings for old Readium betas on trunk vs the spec repo are harmless.

To check the patch compiles without building the whole app:

```bash
LANG=en_US.UTF-8 xcodebuild -project ios/Pods/Pods.xcodeproj -target react-native-readium -sdk iphonesimulator -configuration Debug build
```

`LANG` is not optional from a non-interactive shell — CocoaPods and xcodebuild otherwise read podspecs
as US-ASCII and die on the first non-ASCII byte in a dependency's `package.json`, with an error that
blames the dependency rather than the encoding.
