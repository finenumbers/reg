/**
 * At most two OPRS facet reads hold a pool connection.
 * A waiter whose browser already left does not take a slot.
 * A query that has started is not cancelled: the pooled backend is reused.
 */

export class OprsFacetLaneAbort extends Error {
  constructor() {
    super("Отменено");
    this.name = "OprsFacetLaneAbort";
  }
}

const LIMIT = 2;

type Waiter = {
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: unknown) => void;
};

let active = 0;
const waiters: Waiter[] = [];

function wake(): void {
  while (active < LIMIT && waiters.length > 0) {
    const waiter = waiters.shift();
    if (!waiter) return;
    if (waiter.signal.aborted) {
      waiter.reject(new OprsFacetLaneAbort());
      continue;
    }
    active += 1;
    waiter.resolve();
  }
}

export function acquireOprsFacetLane(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new OprsFacetLaneAbort());
  if (active < LIMIT && waiters.length === 0) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { signal, resolve, reject };
    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index < 0) return;
      waiters.splice(index, 1);
      reject(new OprsFacetLaneAbort());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    waiter.resolve = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    waiters.push(waiter);
  });
}

export function releaseOprsFacetLane(): void {
  if (active > 0) active -= 1;
  wake();
}

export function resetOprsFacetLaneForTests(): void {
  active = 0;
  waiters.splice(0, waiters.length);
}
