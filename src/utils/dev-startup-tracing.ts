type StartupTrace = {
  originMs: number;
  runId: string;
  marks: Record<string, number>;
  events: StartupTraceEvent[];
  measures: StartupTraceMeasure[];
  didPrintHomeShelfDisplaySummary: boolean;
};

type StartupTracePayload = Record<string, unknown>;

type StartupTracePhase = "beforeHomeShelfDisplay" | "afterHomeShelfDisplay";

type StartupTraceEvent = {
  label: string;
  atMs: number;
  elapsedMs: number;
  phase: StartupTracePhase;
  payload?: StartupTracePayload;
};

type StartupTraceMeasure = {
  label: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  phase: StartupTracePhase;
  payload?: StartupTracePayload;
};

type StartupTraceSnapshot = {
  originMs: number;
  runId: string;
  marks: Record<string, number>;
  events: StartupTraceEvent[];
  measures: StartupTraceMeasure[];
};

const TRACE_KEY = "__laabsStartupTrace";
const VERBOSE_KEY = "__LAABS_STARTUP_TIMING_VERBOSE__";

const getNow = () => globalThis.performance?.now?.() ?? Date.now();

const createRunId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isVerboseStartupTimingEnabled = () => {
  const root = globalThis as typeof globalThis & {
    [VERBOSE_KEY]?: boolean;
  };

  return root[VERBOSE_KEY] === true;
};

const shouldRecordStartupTrace = () => __DEV__ || isVerboseStartupTimingEnabled();

const getTrace = (): StartupTrace | null => {
  if (!shouldRecordStartupTrace()) return null;

  const root = globalThis as typeof globalThis & {
    [TRACE_KEY]?: StartupTrace;
  };

  if (!root[TRACE_KEY]) {
    root[TRACE_KEY] = {
      originMs: getNow(),
      runId: createRunId(),
      marks: {},
      events: [],
      measures: [],
      didPrintHomeShelfDisplaySummary: false,
    };
  }

  return root[TRACE_KEY] ?? null;
};

const getPhase = (trace: StartupTrace): StartupTracePhase =>
  trace.marks["home-shelf-display"] ? "afterHomeShelfDisplay" : "beforeHomeShelfDisplay";

const roundMs = (value: number) => Math.round(value);

const formatBytes = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "0B";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)}KB`;
  }

  return `${Math.round(value)}B`;
};

const findMeasure = (trace: StartupTrace, label: string) =>
  trace.measures.find((measure) => measure.label === label);

const formatMeasure = (trace: StartupTrace, label: string) => {
  const measure = findMeasure(trace, label);
  return measure ? `${roundMs(measure.durationMs)}ms` : "?";
};

const getHomeMeasureSummary = (trace: StartupTrace) => {
  const summaries = new Map<
    string,
    {
      count: number;
      totalMs: number;
      maxMs: number;
    }
  >();

  trace.measures
    .filter((measure) => measure.label.startsWith("home "))
    .forEach((measure) => {
      const label = measure.label.replace(/^home /, "");
      const current = summaries.get(label) ?? {
        count: 0,
        totalMs: 0,
        maxMs: 0,
      };

      summaries.set(label, {
        count: current.count + 1,
        totalMs: current.totalMs + measure.durationMs,
        maxMs: Math.max(current.maxMs, measure.durationMs),
      });
    });

  return [...summaries.entries()]
    .map(([label, summary]) => {
      const total = `${roundMs(summary.totalMs)}ms`;
      if (summary.count <= 1) {
        return `${label} ${total}`;
      }

      return `${label} ${total} total/${summary.count}x max ${roundMs(summary.maxMs)}ms`;
    })
    .join(", ");
};

const maybeVerboseLog = (
  kind: "event" | "measure" | "mark",
  label: string,
  payload?: StartupTracePayload,
) => {
  if (!__DEV__ || !isVerboseStartupTimingEnabled()) return;
  console.info(`[startup-timing:${kind}] ${label}`, payload ?? {});
};

export const markStartup = (name: string) => {
  const trace = getTrace();
  const now = getNow();

  if (trace) {
    trace.marks[name] = now;
    maybeVerboseLog("mark", name, {
      elapsedMs: roundMs(now - trace.originMs),
    });
  }

  return now;
};

export const getStartupMark = (name: string) => {
  const trace = getTrace();
  return trace?.marks[name];
};

export const logStartupEvent = (
  label: string,
  payload?: StartupTracePayload,
) => {
  const trace = getTrace();
  if (!trace) return;

  const atMs = getNow();
  const event = {
    label,
    atMs,
    elapsedMs: atMs - trace.originMs,
    phase: getPhase(trace),
    payload,
  };

  trace.events.push(event);
  maybeVerboseLog("event", label, {
    elapsedMs: roundMs(event.elapsedMs),
    phase: event.phase,
    ...(payload ?? {}),
  });
};

export const logStartupDuration = (
  label: string,
  startedAtMs: number | undefined | null,
  payload?: StartupTracePayload,
) => {
  const trace = getTrace();
  if (!trace || typeof startedAtMs !== "number") return;

  const endedAtMs = getNow();
  const measure = {
    label,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    phase: getPhase(trace),
    payload,
  };

  trace.measures.push(measure);
  maybeVerboseLog("measure", label, {
    durationMs: roundMs(measure.durationMs),
    phase: measure.phase,
    ...(payload ?? {}),
  });
};

export const measureStartupSync = <T>(
  label: string,
  task: () => T,
  getPayload?: (result: T) => StartupTracePayload,
) => {
  const startedAtMs = getNow();

  try {
    const result = task();
    logStartupDuration(label, startedAtMs, getPayload?.(result));
    return result;
  } catch (error) {
    logStartupDuration(`${label} failed`, startedAtMs, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const getStartupTraceSnapshot = (): StartupTraceSnapshot | null => {
  const trace = getTrace();
  if (!trace) return null;

  return {
    originMs: trace.originMs,
    runId: trace.runId,
    marks: { ...trace.marks },
    events: [...trace.events],
    measures: [...trace.measures],
  };
};

export const recordHomeShelfDisplay = (payload: StartupTracePayload) => {
  const trace = getTrace();
  if (!trace || trace.didPrintHomeShelfDisplaySummary) return false;

  const displayAtMs = markStartup("home-shelf-display");
  trace.didPrintHomeShelfDisplaySummary = true;
  logStartupEvent("home shelf display", payload);

  if (__DEV__) {
    const queryRestoreMeasure = findMeasure(trace, "query restore complete");
    const queryPayload = queryRestoreMeasure?.payload ?? {};
    const summary = [
      `[startup] Home Shelf Display in ${roundMs(displayAtMs - trace.originMs)}ms`,
      `auth ${formatMeasure(trace, "auth hydrate complete")}`,
      `secureStore ${formatMeasure(trace, "secure-store credentials read")}/${formatMeasure(
        trace,
        "secure-store tokens read",
      )}`,
      `queryRestore ${formatMeasure(trace, "query restore complete")} (${formatBytes(
        queryPayload.persistedCacheBytes,
      )}, ${String(queryPayload.restoredQueryCount ?? "?")}q)`,
      `initialUrl ${formatMeasure(trace, "initial URL resolved")}`,
      `homeHook ${formatMeasure(trace, "home shelves hook to layout")}`,
      `renderLayout ${formatMeasure(trace, "home shelves render to layout")}`,
      `visible ${formatMeasure(trace, "home visible shelves projection")} (${String(
        payload.catalogCount ?? "?",
      )} books -> ${String(payload.visibleBookCount ?? "?")} visible)`,
    ].join(" | ");

    console.info(summary, {
      runId: trace.runId,
      phase: "beforeHomeShelfDisplay",
      homeMeasures: getHomeMeasureSummary(trace),
      ...payload,
    });
  }

  return true;
};
