# Testing Delegation

Whenever testing something — with argent tools or by any other means (simulator interaction,
AppleScript/CGEvent driving, log-capture repro loops, UI verification) — always delegate the
testing to an Agent using `model: "opus"` (Opus 4.6 or the newest available Opus).
