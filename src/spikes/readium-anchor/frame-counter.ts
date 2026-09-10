/**
 * E5 — the decoration cost is native, so JS timers around `setState` measure
 * nothing. Counting the frames the JS thread actually gets does see it: a
 * healthy 60 Hz device manages ~120 frames in two seconds, and a native hitch
 * drags that number down.
 */

const now = () =>
  typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();

export const countFrames = (windowMs = 2000): Promise<number> =>
  new Promise((resolve) => {
    let frames = 0;
    const startedAt = now();

    const tick = () => {
      frames += 1;
      if (now() - startedAt < windowMs) {
        requestAnimationFrame(tick);
      } else {
        resolve(frames);
      }
    };

    requestAnimationFrame(tick);
  });

/** Waits for one frame, so a decoration prop has been flushed before counting. */
export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Frames per second implied by a sample — the number that is worth comparing. */
export const framesPerSecond = (frames: number, windowMs: number) =>
  windowMs <= 0 ? 0 : (frames / windowMs) * 1000;
