export const ASSISTANT_PENDING_RETRY_DELAYS_MS = [50, 150, 400, 800] as const;

export const schedulePendingDeliveryRetries = (
  attempt: () => boolean,
  delays: readonly number[] = ASSISTANT_PENDING_RETRY_DELAYS_MS,
  setTimeoutFn: typeof setTimeout = setTimeout,
) => {
  let done = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const run = () => {
    if (done) return;
    if (!attempt()) return;
    done = true;
    for (const timer of timers) clearTimeout(timer);
  };
  run();
  if (!done) {
    for (const delay of delays) {
      timers.push(setTimeoutFn(run, delay));
    }
  }
  return () => {
    done = true;
    for (const timer of timers) clearTimeout(timer);
  };
};
