# `react-native-screens` patches — catalog

Single source of truth for everything inside
`patches/react-native-screens+4.26.2.patch`. The current patch contains one fix for
the iOS 26 `NativeTabs.BottomAccessory` (mini-player) on this app's tab layout.

> How patches reach an EAS build (CNG / gitignored `ios/`) is documented separately in
> [`eas-patch-package-cng-builds.md`](./eas-patch-package-cng-builds.md). TL;DR: the
> `eas-build-post-install: patch-package` script in `package.json` is what makes native
> `.mm` edits survive to compile time. **Native (`.mm`) changes require a native rebuild;
> a Metro reload is not enough.**

## Required upgrade gate

Whenever Expo, React Native, Expo Router, or `react-native-screens` is upgraded:

1. Check the installed `react-native-screens` source and upstream release notes/issues to see
   whether the dual-content BottomAccessory duplication has been fixed.
2. On an iOS 26 simulator/device, play media, open the main player from the mini-player, dismiss
   it, and confirm there is exactly one cover, metadata block, and play/pause control. Repeat the
   cycle at least twice.
3. If upstream is fixed, remove the patch and rerun the reproduction before committing the
   upgrade. If it is not fixed, port/regenerate the patch for the exact installed version and
   update this document and the patch filename together.
4. Run `npm run postinstall` after the upgrade and confirm `patch-package` reports the installed
   `react-native-screens` version as successfully patched. A stale versioned patch is not
   protection—the 4.25.2 → 4.26.2 upgrade silently left this workaround behind until the doubled
   mini-player was reproduced again.

---

## Current patch — Single-content BottomAccessory path (anti-duplication)

**File (live):** `src/components/tabs/host/TabsHost.ios.tsx`
**Files (redundant mirrors):** `lib/commonjs/.../TabsHost.ios.js`, `lib/module/.../TabsHost.ios.js`
**Problem:** On RN ≥ 0.82 the stock `TabsHost` mounts **both** the `regular` and `inline`
`TabsBottomAccessoryContent` views simultaneously and hides the inactive one purely via
`layer.opacity` in `RNSTabsBottomAccessoryHelper`. `invalidateLayer` (fired by
`finalizeUpdates` / trait changes) resets that opacity back to `1.0` without a guaranteed
re-apply, so presenting + dismissing the `/main-player` `card` leaves **both** content views
visible → a doubled / overlaid mini-player.
**Fix:** Force the older single-content path on all RN versions — render one
`TabsBottomAccessory` whose content is `ios.bottomAccessory(bottomAccessoryEnvironment)`,
driven by `onEnvironmentChange`. Only one content view is ever mounted, so
`isContentViewSwitchingWorkaroundActive` stays false and the opacity-switching bug can't
occur. Trade-off: the minimize transition swaps content reactively instead of the native
cross-fade (possible minor flicker, never duplication).
**Why `src/`, not `lib/`:** `react-native-screens/package.json` sets `"react-native":
"src/index"`, and Expo's default Metro `resolverMainFields` is `['react-native','browser',
'main']` — so **Metro runs the TypeScript under `src/`**, never the prebuilt `lib/` bundles.
A JS patch that only edits `lib/` is dead code. The `lib/*` hunks in our patch are harmless
mirrors; the `src/` hunk is the one that runs.
**Verify:** JS-only — reload Metro (`--clear`), play a book, open `/main-player`, swipe down.
No doubled accessory.
**Upgrade check:** if upstream's `src/.../TabsHost.ios.tsx` still mounts separate `regular`
and `inline` `TabsBottomAccessoryContent` children, keep and regenerate this patch. If upstream
uses one content tree or has otherwise fixed the visibility lifecycle, remove the patch and prove
the open/dismiss reproduction stays green before shipping the upgrade.

---

## Rollback (all patches)

```bash
npx patch-package react-native-screens --reverse   # revert node_modules in place
rm patches/react-native-screens+4.26.2.patch       # drop the patch
npx expo run:ios                                    # native rebuild required
```
To remove a single fix, edit the patched `node_modules` file back to stock and re-run
`npx patch-package react-native-screens` to regenerate the patch without that hunk.

*Related: `eas-patch-package-cng-builds.md` (how patches survive EAS managed builds).*
