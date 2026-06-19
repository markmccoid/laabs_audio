# Local iOS Build → TestFlight

How to build a production iOS IPA **on your own Mac** (no EAS cloud build minutes) and
push it to App Store Connect / TestFlight, plus an explanation of what actually happens
under the hood.

> Verified working on the Mac mini, June 2026. App: `com.markmccoid.laabs-audio`.

---

## TL;DR — the commands

```bash
# 0. (once per session) make sure you're logged in to EAS
eas login            # only if `eas whoami` is empty
eas whoami

# 1. Build a signed production IPA locally
eas build --platform ios --profile production --local

#    → produces ./build-<timestamp>.ipa in the project root

# 2. Upload that IPA to App Store Connect (lands in TestFlight after processing)
eas submit --platform ios --path ./build-<timestamp>.ipa --profile production
```

That's the whole loop. Everything below explains *why* it works and what each piece does.

---

## Prerequisites (one-time)

These are already set up on the Mac mini, listed here for reference / a fresh machine:

| Requirement | Notes |
|-------------|-------|
| macOS + **Xcode** | `xcodebuild -version` should work. Xcode 26.x here. |
| **eas-cli** | `eas --version`. Installed globally. |
| **fastlane** | `fastlane --version` must run cleanly. ⚠️ See gotcha below. |
| **Apple Developer account** ($99/yr) | Needed for any distribution build. |
| **EAS login** | `eas whoami` → `markmccoid`. Required even for local builds (see "Why EAS is still involved"). |

### ⚠️ fastlane / Homebrew-Ruby gotcha

If a build fails with **"Fastlane is not available"** even though `which fastlane` finds it,
it's almost always a Ruby/bundler version clash after a Homebrew upgrade. Fix:

```bash
fastlane --version          # if this errors with Gem::MissingSpecError, that's the cause
brew upgrade fastlane       # rebuilds fastlane against the current Homebrew Ruby
```

(This bit us once: Homebrew bumped Ruby to 4.0, whose default bundler is 4.x, but the old
fastlane pinned `bundler < 3.0.0`. Upgrading fastlane fixed it.)

---

## Step 1 — Build the IPA locally

```bash
eas build --platform ios --profile production --local
```

- `--platform ios` — build for iOS.
- `--profile production` — use the `build.production` profile from `eas.json`.
- `--local` — **run the entire EAS build pipeline on this Mac** instead of EAS's cloud
  builders. Same steps, same scripts, your hardware, no build-minute cost.

When it finishes you'll see:

```
Build successful
You can find the build artifacts in /…/laabs_audio/build-<timestamp>.ipa
```

The IPA (~41 MB) is signed for the **App Store** distribution profile, so it's ready to ship —
not a dev/ad-hoc build.

> Note: `appVersionSource: "remote"` means the **build number is stored on EAS servers** and
> the `production` profile has `autoIncrement: true`, so every local build bumps that number
> (e.g. 56 → 57) and **requires you to be logged in and online**. The version *name*
> (`1.4.6`) still comes from `app.json`.

---

## Step 2 — Upload to App Store Connect / TestFlight

```bash
eas submit --platform ios --path ./build-<timestamp>.ipa --profile production
```

- Uses the `submit.production` block in `eas.json`.
- Uploads the IPA to App Store Connect via Apple's API.
- After Apple finishes processing (a few minutes to ~an hour), the build appears under
  **TestFlight** in App Store Connect.

The first time you submit, EAS will set up an **App Store Connect API key** (it can create
and store one for you, the same way it manages your signing credentials). Subsequent submits
reuse it.

> Alternative manual upload: you can also drag the `.ipa` into **Transporter.app**, or use
> `xcrun altool` / `xcrun notarytool`. `eas submit` is just the convenient wrapper.

After it's in TestFlight you still use the **App Store Connect web UI** to add testers,
fill in "What to Test" notes, and (for external testers) submit for Beta App Review.

---

## Does this use up my EAS free-plan build quota?

**No.** The free plan's limit (**30 builds/month total — up to 15 iOS and up to 15 Android**)
applies only to **cloud builds** that run on EAS's servers. A `--local` build runs entirely
on this Mac; the only thing it asks EAS for is your signing credentials and the build number,
and those API calls are **not** counted as builds. `eas submit` doesn't count either (it's an
upload, not a build).

| Action | Counts against quota? |
|--------|----------------------|
| `eas build ... ` (no `--local`, runs in EAS cloud) | ✅ Yes |
| `eas build ... --local` | ❌ No (runs on your Mac) |
| `eas submit ...` | ❌ No |
| Credential / version-number calls during `--local` | ❌ No |

So the local workflow in this doc is effectively unlimited.

## What is actually happening under the hood

This is the part worth understanding. `eas build --local` is **not** just `xcodebuild` —
it runs the same multi-phase pipeline EAS runs in the cloud, on your machine.

### The phases (you can see these as `[PHASE_NAME]` tags in the output)

1. **Resolve config & credentials**
   - Reads `eas.json`, picks the `production` profile.
   - Talks to EAS servers to fetch your **distribution certificate** + **provisioning
     profile** ("Using remote iOS credentials"), and to read/increment the **build number**.
   - This is why login + network are required even for a local build.

2. **Stage the project** ("Compressing project files" / "Computing project fingerprint")
   - EAS makes a **clean copy** of your project into a temp dir
     (`/private/var/folders/.../eas-build-local-nodejs/<uuid>/build/`).
   - Crucially, it copies only files **git would track** — so your gitignored `ios/` and
     `node_modules/` are **excluded** from the snapshot. (More on this below.)

3. **Install dependencies & run hooks**
   - `npm install` in the staging dir.
   - Runs your **`eas-build-post-install`** script (`patch-package`) so your native patches
     are applied. (See `docs` / memory on the patch-package + CNG setup.)

4. **Prebuild — generate the native iOS project (CNG)**
   - Runs `expo prebuild` in the staging dir, which **generates a fresh `ios/` folder** from
     `app.json` + installed Expo config plugins, then `pod install`.
   - ➡️ **It does NOT use your local `ios/` directory.** See next section.

5. **Compile & archive (this is where fastlane comes in)**
   - EAS invokes **fastlane** to drive Xcode:
     - `gym` (a.k.a. `build_app`) runs `xcodebuild archive` → produces a `.xcarchive`,
       then exports a **signed `.ipa`** using the provisioning profile from phase 1.
     - It also exports **dSYM** symbol files (for crash symbolication).
   - You'll see `[RUN_FASTLANE] ... Successfully exported and signed the ipa file`.

6. **Collect artifacts**
   - Copies the IPA out of the temp dir to your project root as `build-<timestamp>.ipa`.

### So: does it generate `ios/` or use the local one?

**It generates a brand-new one, every build.** Your project uses **Continuous Native
Generation (CNG)** — `ios/` is gitignored and treated as disposable build output, not source.

| `ios/` directory | Used by |
|------------------|---------|
| The local `ios/` in your repo | Only **`expo run:ios`** (dev builds on the simulator/device). Created on demand by prebuild for local development. |
| The `ios/` inside the EAS staging temp dir | Generated fresh during **`eas build --local`** phase 4. This is the one that actually ships. |

Because the staging snapshot excludes your gitignored local `ios/`, **changes you make by
hand inside `ios/` will NOT appear in a production build.** The source of truth for native
config is:
- `app.json` (bundle id, Info.plist entries, permissions, icons, plugins…), and
- Expo **config plugins** + your **patches** (applied via `eas-build-post-install`).

If you ever need to change native behavior, change it *there*, not in `ios/`.

> Tip: to preview what prebuild will generate, run `npx expo prebuild -p ios` locally — but
> remember that's just for inspection; the real build regenerates it in the temp dir.

---

## The role of `eas.json`

`eas.json` is the **control file** for both building and submitting. Yours:

```jsonc
{
  "cli": {
    "version": ">= 16.19.3",
    "appVersionSource": "remote"   // build number lives on EAS servers
  },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview":     { "distribution": "internal" },              // ad-hoc / internal testers
    "production":  { "autoIncrement": true }                    // App Store builds, auto-bump build #
  },
  "submit": {
    "production": {}   // App Store Connect submission settings (empty = use defaults/managed)
  }
}
```

What each part controls:

- **`cli.appVersionSource: "remote"`** — version/build numbers are tracked by EAS, not in
  native files. With `production.autoIncrement: true`, the build number increments on each
  production build. (If you preferred numbers in `app.json`/Info.plist, you'd set this to
  `"local"`.)
- **`build.<profile>`** — named build configurations. `--profile production` selects
  `build.production`. Profiles control distribution type, auto-increment, env vars, native
  flags, etc.
  - `production` → App Store distribution (what you submit to TestFlight/App Store).
  - `preview` → `internal` distribution, for installing directly on registered devices.
  - `development` → dev client for daily development.
- **`submit.<profile>`** — settings used by `eas submit` (which Apple account / API key /
  app to push to). Empty here means EAS uses managed defaults and will prompt/set up an API
  key the first time.

Think of it as: **`eas.json` = *how* to build/submit; `app.json` = *what* the app is**
(identity, capabilities, native config).

---

## Build profiles cheat-sheet

```bash
# Production App Store build (for TestFlight / App Store)
eas build --platform ios --profile production --local

# Internal/ad-hoc build you can install on registered devices without TestFlight
eas build --platform ios --profile preview --local

# Dev client
eas build --platform ios --profile development --local
```

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `Fastlane is not available` | `brew upgrade fastlane` (Ruby/bundler clash). |
| Hangs asking to log in | Run `eas login`; or add `--non-interactive` once creds are cached. |
| Build number didn't bump / "must be online" | `appVersionSource: remote` needs network + login. |
| Native change not in the build | You edited `ios/` directly — move the change to `app.json` / a config plugin / a patch instead (CNG regenerates `ios/`). |
| Pod install errors | Usually a plugin/patch issue; reproduce with `npx expo prebuild -p ios && cd ios && pod install`. |

⚠️ **Security note:** eas-cli prints the local-build job payload to stdout, which includes
your **provisioning profile and distribution certificate (private key)** as base64. Don't
commit or share raw build logs, and delete any you redirect to `/tmp`.

---

## Further reading

- EAS Build — local builds: https://docs.expo.dev/build-reference/local-builds/
- `eas.json` reference: https://docs.expo.dev/build/eas-json/
- App version & build number management (`appVersionSource`): https://docs.expo.dev/build-reference/app-versions/
- Continuous Native Generation (CNG) / prebuild: https://docs.expo.dev/workflow/continuous-native-generation/
- `expo prebuild` command: https://docs.expo.dev/more/expo-cli/#prebuild
- EAS Submit (to App Store Connect): https://docs.expo.dev/submit/ios/
- TestFlight (Apple): https://developer.apple.com/testflight/
- fastlane `gym` (build_app): https://docs.fastlane.tools/actions/gym/
- fastlane `pilot` (upload_to_testflight): https://docs.fastlane.tools/actions/pilot/
- Apple Transporter (manual upload): https://apps.apple.com/app/transporter/id1450874784
