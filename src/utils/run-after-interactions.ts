/**
 * Defers non-urgent work until the JS thread is idle.
 *
 * Replaces `InteractionManager.runAfterInteractions`, which React Native 0.87 removed. The
 * timeout keeps the work from waiting indefinitely when the thread is never idle (e.g. during
 * a long startup animation).
 */
const IDLE_TIMEOUT_MS = 500;

export type DeferredTask = { cancel: () => void };

export const runAfterInteractions = (task: () => void): DeferredTask => {
  const handle = requestIdleCallback(() => task(), { timeout: IDLE_TIMEOUT_MS });
  return { cancel: () => cancelIdleCallback(handle) };
};
