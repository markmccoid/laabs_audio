# `react-native-screens` patches — catalog

Single source of truth for everything inside
`patches/react-native-screens+4.25.2.patch`. That one patch file bundles **three
independent fixes** to `react-native-screens@4.25.2`, all targeting the iOS 26
`NativeTabs.BottomAccessory` (mini-player) on this app's tab layout.

> How patches reach an EAS build (CNG / gitignored `ios/`) is documented separately in
> [`eas-patch-package-cng-builds.md`](./eas-patch-package-cng-builds.md). TL;DR: the
> `eas-build-post-install: patch-package` script in `package.json` is what makes native
> `.mm` edits survive to compile time. **Native (`.mm`) changes require a native rebuild;
> a Metro reload is not enough.**

When you bump `react-native-screens`, re-check each section below against the new source
before assuming the patch still applies (patch-package will also fail loudly if a hunk no
longer matches).

---

## Patch A — Tab-bar minimize / inline trigger

**File:** `ios/tabs/screen/RNSTabsScreenViewController.mm`
**Problem:** On iOS 26, UIKit drives `tabBarMinimizeBehavior` ("onScrollDown") off
`UIViewController.contentScrollView(for:)`. Its default search can't find a React Native
scroll view through the `NativeTab → nested Stack → screen` hierarchy, so the tab bar never
minimizes and the bottom accessory never enters the **inline** environment.
**Fix:** Override `contentScrollViewForEdge:` + a BFS helper
(`rns_findDescendantScrollViewInView:`) to locate the screen's `UIScrollView`, and
eagerly register it via `setContentScrollView:forEdge:` in `viewDidLayoutSubviews` and
`viewDidAppear:` (UIKit ignores registrations made while a tab is off-screen).
**Refs:** callstack/react-native-bottom-tabs#496 (same bug in another lib).
**Verify in a build (deterministic):**
```bash
strings -a ".../RNScreens.framework/RNScreens" | grep -c "rns_findDescendantScrollViewInView"  # >0 = present
```
**Upgrade check:** the upstream file must have all three of — (1) `contentScrollViewForEdge:`
override, (2) eager `setContentScrollView:forEdge:` in `viewDidLayoutSubviews`, (3)
re-registration in `viewDidAppear:`. See `ROLLBACK_ACCESSORY_INLINE.md` for the longer note.

## Patch B — Single-content BottomAccessory path (anti-duplication)

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
**Upgrade check:** if upstream's `src/.../TabsHost.ios.tsx` still branches on
`reactNativeVersion.minor >= 82` into two `TabsBottomAccessoryContent` children, keep this
patch. If they've fixed the opacity-switch lifecycle, you may be able to drop it.

## Patch C — Stuck-inline after a card dismiss (four interacting fixes)

**Files:** `ios/tabs/bottom-accessory/RNSTabsBottomAccessoryComponentView.mm`,
`ios/tabs/bottom-accessory/RNSTabsBottomAccessoryHelper.mm`

**Symptom:** Play a book → scroll so the accessory goes **inline** → open the `/main-player`
`card` → dismiss. The tab bar expands back to regular but the accessory stays a narrow inline
pill. (Opening the card *from regular* works, and "primes" it so later inline cycles also work
— that asymmetry was the key clue.) This took four layered fixes; each unblocked the next.
The trigger: `/main-player` is `presentation: "card"`, so the full-screen card removes the tab
host (and accessory) from the window, running `-invalidate`.

1. **Helper recreation on window re-entry** — `RNSTabsBottomAccessoryComponentView.didMoveToWindow`.
   `-invalidate` nils `_helper`/`_shadowStateProxy`; upstream's return path only re-messages the
   now-nil `_helper`, so the environment-trait observer and frame observer are never
   re-established. Fix: when re-entering the window, recreate `_helper`/`_shadowStateProxy` if nil.

2. **Deferred env re-assert** — same method. The trait observer only fires on *changes*, and on a
   physical device the trait isn't settled at `didMoveToWindow` time, so a synchronous emit can be
   stale. Re-emit `emitOnEnvironmentChangeIfNeeded:` on the next runloop turn (dedupes, so it's a
   no-op when already correct).

3. **Frame re-sync on trait change** — `RNSTabsBottomAccessoryHelper.registerForAccessoryEnvironmentChanges`.
   The env correctly flips to regular but the **size** doesn't, because the frame observer watches
   the wrapper's **`center`**, which is *invariant* across regular↔inline (only width/origin change;
   center stays put) — so a width-only resize never fires the KVO. Fix: on each env change, force a
   frame-observer re-registration (deferred a tick). The explicit `unregister` first is required —
   `registerForAccessoryFrameChanges` early-returns when the wrapper pointer is unchanged.

4. **Preserve Fabric `state` across `invalidate`** — `RNSTabsBottomAccessoryComponentView.invalidateImpl`
   (commented-out `_state.reset()`). Even with #3 pushing the right frame, it landed nowhere:
   `RNSTabsBottomAccessoryShadowStateProxy.updateShadowStateWithFrame:` no-ops when
   `_bottomAccessoryView.state == nullptr`, and `-invalidate` had reset it with no Fabric
   re-delivery on return. Keeping the `shared_ptr` is safe (these views aren't recycled —
   `shouldBeRecycled == NO` — and it releases on dealloc).

**Refs:** same lifecycle area as react-native-screens #3948. Both the `_state.reset()` on a
transient window-removal and the `center`-only frame observer are genuine upstream bugs worth
reporting.
**Verify:** native rebuild → play → scroll inline → open `/main-player` → dismiss → accessory
snaps back to the full-width regular bar. (No unique selector to grep; all changes are inside
existing methods. Earlier diagnostics used a temporary `[laabs]` `NSLog` prefix — fully removed.)
**Upgrade check:** re-verify all four points survive an RNS bump — especially that `invalidate`
no longer discards `state` and that the frame observer reacts to a width-only resize.
**Known tradeoff:** the single-content path + frame re-sync means regular↔inline transitions
re-layout reactively (a brief flash) instead of UIKit's native cross-fade — cosmetic, and
inherent to avoiding the duplication from Patch B. See `mini-player-bottom-accessory.tsx`.

---

## Rollback (all patches)

```bash
npx patch-package react-native-screens --reverse   # revert node_modules in place
rm patches/react-native-screens+4.25.2.patch       # drop the patch
npx expo run:ios                                    # native rebuild required
```
To remove a single fix, edit the patched `node_modules` file back to stock and re-run
`npx patch-package react-native-screens` to regenerate the patch without that hunk.

*Related: `ROLLBACK_ACCESSORY_INLINE.md` (original Patch A change-log),
`eas-patch-package-cng-builds.md` (how patches survive EAS managed builds).*
