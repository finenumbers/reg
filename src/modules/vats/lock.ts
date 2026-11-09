/**
 * One Boss HTTP call at a time, shared by every Next bundle. The queue is
 * FIFO. The walk leaves the lock before the next card, so an operator who
 * queued during that card runs first.
 */

const KEY = "__reg_vats_boss_lock__";

type LockState = { tail: Promise<unknown> };

function lockState(): LockState {
  const g = globalThis as typeof globalThis & { [KEY]?: LockState };
  if (!g[KEY]) g[KEY] = { tail: Promise.resolve() };
  return g[KEY];
}

export function withBossLock<T>(fn: () => Promise<T>): Promise<T> {
  const state = lockState();
  const run = state.tail.then(fn, fn);
  state.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
