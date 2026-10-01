---
status: accepted
---

# Latest Requested Playback State governs controls

Immediate Cancel loading symbols flash during quick transitions, and ignoring opposite commands makes controls feel unresponsive. LAABS Audio keeps one latest Requested Playback State for the targeted audiobook or Episode, accepting play/pause changes immediately across app and system controls; Playback Preparation continues when the user requests Pause, while selecting another playable replaces the preparation target. This supersedes ADR-0012's first-intent-wins and Pause-cancels-preparation policies and ADR-0007's Cancel loading presentation; implemented on 2026-09-30.

**Considered Options**

- Keep the X and cancel/restart preparation on each change: loses reusable preparation and exposes a transient symbol during ordinary playback actions.
- Queue every toggle: delayed execution can replay obsolete commands and produce unintended audio bursts.
- Keep controls disabled until the current command settles: prevents the user from correcting their requested outcome immediately.

**Consequences**

- Requested Playback State and Audible Playback State are distinct. Controls immediately show the opposite action to the latest request, while audible confirmation and committed Listening Position remain evidence of actual playback.
- Preparation and native transitions must check the latest requested target and state before starting audio. Old completions cannot overwrite a newer request, playable, or progress.
- Native lock-screen, headphone, and CarPlay commands must honor the same semantics while JavaScript is backgrounded: explicit commands set state, and toggles flip the latest request.
- Play/Pause symbols remain visible without activity indicators. One app-level “Still loading audio…” toast appears after three seconds of waiting for requested playback, once per continuous wait. Pause suppresses it; playback, failure, or replacement dismisses it.
- Failure after Pause leaves persistent preparation error feedback, available Play, and preserved confirmed progress without a popup. Existing bounded attempts and fresh-source retry remain required.
- Headphone disconnection requires explicit Play to resume. Temporary interruption resumes only with OS permission and no subsequent user Pause. Preparation cannot override interruption conditions.

See [the agreed UX design](../playback-controls-ux-design.md) for scenarios and the implementation outline.
