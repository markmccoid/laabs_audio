# Future Authentication Flow Enhancements

This document captures future improvements discussed while working on Authentication, Library Selection, and Library Activation. These are not current implementation requirements.

## Goals

- Make Authentication and Library Selection feel like one coherent entry flow.
- Reduce route-specific behavior in the Library picker.
- Improve recovery when a User Session exists but server access is temporarily unavailable.
- Keep Home protected from half-loaded Library state.

## 1. Deepen the Library Activation Module

Current friction:

- The Home menu and Authentication screen are different adapters into the same domain action.
- The picker sheet has to know route timing details before calling activation.
- It is easy to accidentally create a second Library switching behavior.

Future direction:

- Treat Library Activation as a deeper module with a small interface.
- Callers should provide only the chosen Library and a small routing intent.
- The module should own activation state, data readiness, commit, success navigation, and failure recovery.

Expected benefit:

- Better locality: route timing bugs live in one place.
- Better leverage: Home menu, Authentication picker, first sign-in, and automatic one-library setup all use the same behavior.
- Better testability: tests can exercise the activation interface instead of each caller's sequence.

## 2. Split Library Selection Adapters Explicitly

Current friction:

- `/library-picker` is used both during setup and during user-requested switching.
- It can be opened from Authentication settings, login/setup, or route guards.

Future direction:

- Keep one Library Selection surface, but make its adapter role explicit:
  - setup selection
  - authenticated switch selection
  - recovery selection after invalid remembered Active Library

Expected benefit:

- Clearer copy and failure behavior.
- Less conditional route logic inside the picker.
- Easier tests for each flow.

## 3. Add a Dedicated Authentication Recovery Surface

Current friction:

- `downloadedSessionOnly`, `serverSetup`, and `serverBrowsing` are correct domain states, but the UI can feel like generic settings. `downloadedOnly` is deprecated for explicit signed-out access.

Future direction:

- Add a dedicated recovery surface for Session Needs Sign-In.
- Clearly explain whether the user can browse server Libraries, use downloads, or must sign in again.
- Make manual sign-in dismissible when downloaded content is available.

Expected benefit:

- Users understand why server browsing is unavailable.
- Downloaded content remains accessible without making the app feel broken.

## 4. Make Route Transitions Observable During Development

Current friction:

- Library Selection from a native sheet can expose timing bugs that are hard to see from code.

Future direction:

- Add development-only diagnostics for:
  - Access Mode changes
  - Library Selection start
  - Library Activation start/success/failure
  - Active Library commit
  - route changes around activation

Expected benefit:

- Faster diagnosis when a native sheet, route replace, or activation state gets out of order.
- Safer future refactors around Authentication and Library Selection.

## 5. Improve Activation Failure UI

Current behavior:

- Failure shows Retry and Cancel.

Future direction:

- Include the selected Library name.
- Include a short offline/server-error hint when known.
- Allow returning directly to Library Selection from failure when the user wants a different Library.

Expected benefit:

- Better recovery from server errors.
- Less confusion when a large Library or slow server causes activation delay.

## 6. Test Scenarios to Add

Add targeted tests or UI flow checks for:

- First run with no credentials and no downloads.
- First run with downloads only.
- Returning User Session with remembered Active Library.
- Returning User Session with invalid remembered Active Library.
- Multiple Libraries after sign-in.
- Library switch from Home menu.
- Library switch from Authentication screen.
- Activation failure with previous Active Library.
- Activation failure with no previous Active Library.

The most valuable regression test is the Authentication screen picker flow because it crosses a sheet adapter, route transition, Library Activation, and Home rendering.
