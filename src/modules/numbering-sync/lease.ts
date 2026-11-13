/**
 * One SipOut walk per process. Next bundles do not share a module `let`,
 * so the holder lives on globalThis, the same way the scheduler does.
 * A generation bump tells an open XLSX that the catalogs were replaced.
 */

const KEY = "__reg_numbering_sync__";

type Slot = {
  generation: number;
  holder: number | null;
  stopping: boolean;
  catalogGeneration: number;
  stopArmed: boolean;
};

function slot(): Slot {
  const g = globalThis as typeof globalThis & { [KEY]?: Slot };
  if (!g[KEY]) {
    g[KEY] = {
      generation: 0,
      holder: null,
      stopping: false,
      catalogGeneration: 0,
      stopArmed: false,
    };
  }
  return g[KEY];
}

export class CatalogReplaced extends Error {
  constructor() {
    super("Каталог обновлён. Повторите выгрузку.");
    this.name = "CatalogReplaced";
  }
}

/** The generation an export must keep until the file is finished. */
export function guardCatalogGeneration(seen?: number): number {
  const current = slot().catalogGeneration;
  if (seen != null && seen !== current) throw new CatalogReplaced();
  return current;
}

/** Call only after the catalog transaction has committed. */
export function noteCatalogReplaced(): void {
  slot().catalogGeneration += 1;
}

export function isNumberingSyncActive(): boolean {
  return slot().holder != null;
}

export function isNumberingSyncStopping(): boolean {
  return slot().stopping;
}

/**
 * SIGTERM sets the flag and does not exit by itself. Next.js already
 * listens for the signal and closes the server. A second listener must
 * not become the only reason the process stays up, so this is armed
 * from startup, after the server handler exists.
 */
export function armNumberingSyncStop(): void {
  const state = slot();
  if (state.stopArmed) return;
  state.stopArmed = true;
  process.on("SIGTERM", () => {
    slot().stopping = true;
  });
}

export function tryBeginNumberingSync():
  | { ok: true; token: number }
  | { ok: false; reason: "busy" | "stopping" } {
  const state = slot();
  if (state.stopping) return { ok: false, reason: "stopping" };
  if (state.holder != null) return { ok: false, reason: "busy" };
  state.generation += 1;
  state.holder = state.generation;
  return { ok: true, token: state.generation };
}

/** The walk that owns `token` clears the holder. A newer walk is left running. */
export function endNumberingSync(token: number): void {
  const state = slot();
  if (state.holder === token) state.holder = null;
}

/** Startup of a new process. Does not touch the catalogs. */
export function resetNumberingSyncProcess(): void {
  const state = slot();
  state.holder = null;
  state.generation += 1;
}
