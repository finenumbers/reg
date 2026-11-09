/**
 * One VATS cycle flag for every Next bundle. A module-level `let` is copied
 * per bundle and would start two walks.
 */

const KEY = "__reg_vats_cycle__";

type Kick = () => void;

type Control = {
  generation: number;
  running: boolean;
  restartRequested: boolean;
  kick: Kick | null;
};

function control(): Control {
  const g = globalThis as typeof globalThis & { [KEY]?: Control };
  if (!g[KEY]) {
    g[KEY] = { generation: 0, running: false, restartRequested: false, kick: null };
  }
  return g[KEY];
}

export function vatsGeneration(): number {
  return control().generation;
}

export function isVatsCycleRunning(): boolean {
  return control().running;
}

export function setVatsCycleRunning(running: boolean): void {
  control().running = running;
}

export function registerVatsKick(kick: Kick): void {
  control().kick = kick;
}

/** Settings saved. An in-flight walk stops at the next request and does not publish. */
export function requestVatsRestart(): void {
  const state = control();
  state.generation += 1;
  state.restartRequested = true;
  if (!state.running) state.kick?.();
}

export function consumeVatsRestart(): boolean {
  const state = control();
  const restart = state.restartRequested;
  state.restartRequested = false;
  return restart;
}
