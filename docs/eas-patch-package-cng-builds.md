# patch-package on EAS managed (CNG) builds — why it silently disappears

**Date:** 2026-06-15
**Symptom:** A `react-native-screens` patch worked perfectly in the local iOS simulator but had no effect on a physical device installed from an EAS build.
**Root cause:** The patch was never compiled into the EAS binary, because `patch-package` ran via `postinstall` and that did not survive EAS's managed (CNG) build sequence.
**Fix:** Add `"eas-build-post-install": "patch-package"` to `package.json` scripts.

---

## Background: how this project is built

There are two ways an Expo/React Native app gets its native iOS project:

| | **Bare workflow** | **Managed / CNG workflow** |
|---|---|---|
| `ios/` folder | committed to git | **gitignored** |
| Native project source | the committed `ios/` | regenerated every build by `expo prebuild` |
| Where native config lives | hand-edited `ios/` files | `app.json` + Expo config plugins |

This project is **CNG** even though an `ios/` folder exists on disk locally. The folder is in `.gitignore`, so:

- It exists on *your machine* (created by a local `expo prebuild` / `expo run:ios`).
- It is **never uploaded to EAS** and **never committed**.

That single fact — `ios/` is gitignored — is what makes EAS treat this as a managed build and regenerate the native project from scratch on every build. It's also the root of the bug below.

> Confirm which mode you're in:
> ```bash
> git check-ignore ios/Podfile && echo "CNG (ios gitignored)" || echo "bare (ios committed)"
> ```

## What `patch-package` actually does

`patch-package` modifies the *source of a dependency inside `node_modules`*. Our patch edits:

```
node_modules/react-native-screens/ios/tabs/screen/RNSTabsScreenViewController.mm
```

It is wired to run automatically via an npm lifecycle script:

```jsonc
// package.json
"scripts": {
  "postinstall": "patch-package"
}
```

For the patch to reach the shipped app, the patched `.mm` file must be on disk **at the moment CocoaPods compiles `react-native-screens`**. If the file is unpatched when the compiler reads it, the change is silently lost — no error, no warning.

## The EAS managed build sequence (and where the patch fell out)

```
1. git checkout            → repo arrives WITHOUT ios/ (gitignored). patches/ IS present.
2. Install dependencies    → npm install → postinstall → patch-package patches node_modules
3. Prebuild                → expo prebuild regenerates ios/, runs `pod install`
4. Compile                 → xcodebuild builds RNScreens.framework from node_modules source
5. Package                 → produces the .ipa
```

In theory step 2 patches the source before step 4 compiles it. In practice, on managed/CNG
builds the `postinstall` patch is **not reliable** relative to the prebuild step — dependency
state can be reinstalled/regenerated between install and compile, reverting the patched file.
The result: `RNScreens.framework` is compiled from the **stock, unpatched** source.

Locally you never see this because:

- Your committed-locally `ios/` is reused (no regeneration).
- Your `node_modules` stays patched from your own `npm install`.

So the simulator (local build) has the patch; the device (EAS build) does not. Same git commit,
different binary.

## How we proved the patch was missing

The patch adds a uniquely-named Objective-C selector that exists nowhere else:
`rns_findDescendantScrollViewInView`. Objective-C selector names survive into the compiled
Mach-O binary as plain strings, so you can grep for them. This makes "did my native patch make
it into the build?" a deterministic check rather than a guess.

```bash
# 1. Get the IPA download URL from the build metadata
eas build:view <BUILD_ID> --json > /tmp/view.json
python3 -c "import json; print(json.load(open('/tmp/view.json'))['artifacts']['buildUrl'])"

# 2. Download + unzip the IPA
curl -fsSL "<buildUrl>" -o /tmp/app.ipa
unzip -q /tmp/app.ipa -d /tmp/extracted

# 3. Find the RNScreens framework binary
#    (react-native-screens links as its own dynamic framework, not into the main binary)
FW="/tmp/extracted/Payload/<AppName>.app/Frameworks/RNScreens.framework/RNScreens"

# 4. Sanity-check the search works: the class should be present regardless of the patch
strings -a "$FW" | grep -c "RNSTabsScreenViewController"        # expect: > 0

# 5. The actual test: is the PATCH compiled in?
strings -a "$FW" | grep -c "rns_findDescendantScrollViewInView" # 0 = patch MISSING, >0 = present
```

Result on the failing build (production build 55):

| String searched | In EAS binary | In local patched source |
|---|---|---|
| `RNSTabsScreenViewController` (the class) | 4 | 4 |
| `rns_findDescendantScrollViewInView` (the patch) | **0** | 4 |
| `contentScrollViewForEdge` (the patch) | **0** | — |

The class was there, the patch was not. Conclusive: the device shipped unpatched code.

> Note: the EAS *build logs* (`artifacts.xcodeBuildLogsUrl`) are **encrypted at rest** — the
> bytes you download aren't gzip/zstd/anything decompressible from the CLI; `eas build:view`
> decrypts them in the browser. So inspecting the **IPA** is the practical way to verify a
> native patch from the command line.

## The fix

EAS provides a dedicated lifecycle hook that runs **on the build server, after dependencies are
installed**, at a point where the patch reliably sticks through to compilation:

```jsonc
// package.json
"scripts": {
  "postinstall": "patch-package",            // keeps local installs patched
  "eas-build-post-install": "patch-package"  // runs on EAS at the right time
}
```

`eas-build-post-install` is an EAS-recognized hook (alongside `eas-build-pre-install`,
`eas-build-on-success`, etc.). Keep `postinstall` too — it covers normal local `npm install`.

### Verify the fix on the next build

Re-run the IPA check above against the new build. The count must be **≥ 1**:

```bash
strings -a ".../RNScreens.framework/RNScreens" | grep -c "rns_findDescendantScrollViewInView"
```

Only after that count is non-zero does it make sense to debug runtime behavior on the device —
before that, there is literally no patched code to run.

## If it ever recurs: the bulletproof option

For CNG projects, the most robust way to apply a native source change is an **Expo config
plugin** using `withDangerousMod`, which edits the file *as part of `expo prebuild` itself*. It
cannot be skipped by install-ordering issues because it runs inside the prebuild that generates
the native project. It's more work than patch-package but is the "correct" CNG-native mechanism
for native edits. Reach for it only if the `eas-build-post-install` hook proves flaky.

## Takeaways

- **Gitignored `ios/` ⇒ managed/CNG build ⇒ EAS regenerates native via `expo prebuild`.** Always
  know which workflow you're in; it changes how patches, native config, and `Podfile` edits reach a build.
- **`postinstall` patch-package is not guaranteed on EAS managed builds.** Use
  `eas-build-post-install` for anything that must be present at native-compile time.
- **"Works in the simulator" ≠ "works in the EAS build."** The simulator uses your local native
  project; EAS regenerates its own. They can diverge even on the same commit.
- **You can verify a native patch deterministically** by grepping the shipped framework binary in
  the IPA for a unique selector the patch introduces — no need to read (encrypted) build logs.

---

*Related: `patches/react-native-screens+4.26.2.patch` (the patch itself) and
`react-native-screens-patches.md` (its purpose, upgrade gate, verification, and removal).*
