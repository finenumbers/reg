/**
 * One Runexis walk. The stop flag is the process flag armed for SipOut.
 * This module does not add a SIGTERM listener.
 */

import { isNumberingSyncStopping } from "@/modules/numbering-sync/lease";

const KEY = "__reg_runexis_sync__";

type Slot = {
  generation: number;
  holder: number | null;
};

function slot(): Slot {
  const g = globalThis as typeof globalThis & { [KEY]?: Slot };
  if (!g[KEY]) g[KEY] = { generation: 0, holder: null };
  return g[KEY];
}

export function isRunexisActive(): boolean {
  return slot().holder != null;
}

export function isRunexisStopping(): boolean {
  return isNumberingSyncStopping();
}

export function tryBeginRunexis():
  { ok: true; token: number } | { ok: false; reason: "busy" | "stopping" } {
  const state = slot();
  if (isNumberingSyncStopping()) return { ok: false, reason: "stopping" };
  if (state.holder != null) return { ok: false, reason: "busy" };
  state.generation += 1;
  state.holder = state.generation;
  return { ok: true, token: state.generation };
}

export function endRunexis(token: number): void {
  const state = slot();
  if (state.holder === token) state.holder = null;
}

/** Startup of a new process. Does not touch the catalog. */
export function resetRunexisProcess(): void {
  const state = slot();
  state.holder = null;
  state.generation += 1;
}
