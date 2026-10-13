import { recordTimingLog } from "../data/sqlite/timing-logger";

/**
 * Dev-only trace of a session or library switch: each gate that holds Home's "Loading library"
 * cover is logged once, as time since the user's tap, to timing_logs (category "switch_gate").
 * Read it in Settings → Shadow SQLite → Timing. See docs/library-switch-performance-todo.md.
 */

type SwitchKind = "session" | "library";

type SwitchTrace = {
  id: string;
  kind: SwitchKind;
  startedAt: number;
  marked: Set<string>;
};

const TRACE_TIMEOUT_MS = 120_000;
let activeTrace: SwitchTrace | null = null;

const currentTrace = () => {
  if (activeTrace && Date.now() - activeTrace.startedAt > TRACE_TIMEOUT_MS) activeTrace = null;
  return activeTrace;
};

export const markSwitchGate = (gate: string, metadata?: Record<string, unknown>) => {
  if (!__DEV__) return;
  const trace = currentTrace();
  if (!trace || trace.marked.has(gate)) return;
  trace.marked.add(gate);
  void recordTimingLog("switch_gate", gate, trace.startedAt, {
    traceId: trace.id,
    kind: trace.kind,
    ...metadata,
  });
};

/** A library activation inside a session switch is a gate of that switch, not a new trace. */
export const beginSwitchTrace = (kind: SwitchKind, metadata?: Record<string, unknown>) => {
  if (!__DEV__) return;
  if (kind === "library" && currentTrace()?.kind === "session") {
    markSwitchGate("library_activation_start", metadata);
    return;
  }
  const startedAt = Date.now();
  activeTrace = {
    id: `${kind}_${startedAt}`,
    kind,
    startedAt,
    marked: new Set([`${kind}_start`]),
  };
  void recordTimingLog("switch_gate", `${kind}_start`, startedAt, {
    traceId: activeTrace.id,
    kind,
    ...metadata,
  });
};

/** Marks the final gate (Home showing the new library's shelves) and closes the trace. */
export const endSwitchTrace = (gate: string, metadata?: Record<string, unknown>) => {
  if (!__DEV__) return;
  markSwitchGate(gate, metadata);
  activeTrace = null;
};
