# Future Enhancements

This document tracks technical debt, refactoring opportunities, and future enhancements for the project.

## Recent Enhancements

- `2026-06-09` `pending` - Replace InteractionManager with modern deferred execution (setTimeout, requestIdleCallback polyfill, startTransition) to prepare for its deprecation.
  Tester focus: verify that deferred operations (clearing deep links, startup queries, home shelf menus) still run reliably and performantly.

## Replace InteractionManager Detailed Context

**Context:**
React Native's `InteractionManager` is being deprecated. It is currently used in a few places to defer execution until after animations or navigation transitions complete.

**Current Usage Locations:**
1. `src/app/_layout.tsx` (Line 318): Clearing `initialDeepLinkBookId`.
2. `src/app/_layout.tsx` (Line 482): Delaying startup query warmup.
3. `src/components/Home/home-shelves-screen.tsx` (Line 131): Deferred rendering of card menus.

**Proposed Replacements:**
1. **Deferred State Updates** (like clearing deep link IDs or rendering child components):
   - Use `setTimeout(..., 0)` to yield to the end of the event loop.
   - Use React 18's `startTransition` or `useDeferredValue` for non-urgent UI updates.
2. **Heavy Background Work** (like query warmup):
   - Implement a safe `requestIdleCallback` polyfill (falling back to `setTimeout` if not natively supported in the JS engine).
