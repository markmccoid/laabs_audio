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
  _label: string,
  _payload?: Record<string, unknown>,
) => {};

export const logStartupDuration = (
  _label: string,
  _startedAtMs: number | undefined | null,
  _payload?: Record<string, unknown>,
) => {
  return;
};
