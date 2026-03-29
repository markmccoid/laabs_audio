type StartupTrace = {
  originMs: number;
  marks: Record<string, number>;
};

const TRACE_KEY = "__laabsStartupTrace";

const getNow = () => globalThis.performance?.now?.() ?? Date.now();

const getTrace = (): StartupTrace | null => {
  if (!__DEV__) return null;

  const root = globalThis as typeof globalThis & {
    [TRACE_KEY]?: StartupTrace;
  };

  if (!root[TRACE_KEY]) {
    root[TRACE_KEY] = {
      originMs: getNow(),
      marks: {},
    };
  }

  return root[TRACE_KEY] ?? null;
};

export const markStartup = (name: string) => {
  const trace = getTrace();
  const now = getNow();

  if (trace) {
    trace.marks[name] = now;
  }

  return now;
};

export const getStartupMark = (name: string) => {
  const trace = getTrace();
  return trace?.marks[name];
};

export const logStartupEvent = (
  label: string,
  payload?: Record<string, unknown>,
) => {
  if (!__DEV__) return;

  const trace = getTrace();
  const now = getNow();

  console.log(`[startup] ${label}`, {
    elapsedMs: trace ? Math.round(now - trace.originMs) : 0,
    ...(payload ?? {}),
  });
};

export const logStartupDuration = (
  label: string,
  startedAtMs: number | undefined | null,
  payload?: Record<string, unknown>,
) => {
  const completedAtMs = getNow();
  const durationMs =
    typeof startedAtMs === "number" ? Math.round(completedAtMs - startedAtMs) : undefined;

  logStartupEvent(label, {
    durationMs,
    ...(payload ?? {}),
  });
};
