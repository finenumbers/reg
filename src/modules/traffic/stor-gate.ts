/**
 * Tracks softswitch STOR writes so cdr.import does not read a file ftp-srv
 * has just truncated with w+. SMG import does not consult this registry.
 * State is on globalThis because Next.js duplicates module instances.
 */

import path from "node:path";

export const CDR_STOR_SETTLE_MS = 2_000;

const STOR_GATE_KEY = "__reg_cdr_stor_gate__";

type StorSlot = {
  generation: number;
  /** Set after a clean finish. Absent while the socket is still open. */
  completedSize?: number;
  /** Set when the write stream errors. The path stays busy briefly. */
  failedAt?: number;
};

type StorGateState = {
  slots: Map<string, StorSlot>;
};

function state(): StorGateState {
  const g = globalThis as typeof globalThis & {
    [STOR_GATE_KEY]?: StorGateState;
  };
  if (!g[STOR_GATE_KEY]) {
    g[STOR_GATE_KEY] = { slots: new Map() };
  }
  return g[STOR_GATE_KEY];
}

function key(absPath: string): string {
  return path.resolve(absPath);
}

export function beginStor(absPath: string): number {
  const slots = state().slots;
  const id = key(absPath);
  const generation = (slots.get(id)?.generation ?? 0) + 1;
  slots.set(id, { generation });
  return generation;
}

export function completeStor(absPath: string, generation: number, size: number): void {
  const slots = state().slots;
  const id = key(absPath);
  const slot = slots.get(id);
  if (!slot || slot.generation !== generation) return;
  slots.set(id, { generation, completedSize: size });
}

export function failStor(absPath: string, generation: number, now = Date.now()): void {
  const slots = state().slots;
  const id = key(absPath);
  const slot = slots.get(id);
  if (!slot || slot.generation !== generation) return;
  if (slot.completedSize != null) return;
  slots.set(id, { generation, failedAt: now });
}

export function isStorBusy(absPath: string, now = Date.now()): boolean {
  const slot = state().slots.get(key(absPath));
  if (!slot) return false;
  if (slot.completedSize != null) return false;
  if (slot.failedAt != null && now - slot.failedAt >= CDR_STOR_SETTLE_MS) {
    return false;
  }
  return true;
}

/** Size recorded at clean finish, if this generation closed. */
export function storCompletedSize(absPath: string): number | undefined {
  const slot = state().slots.get(key(absPath));
  if (!slot || slot.completedSize == null) return undefined;
  return slot.completedSize;
}

export function resetStorGateForTests(): void {
  state().slots.clear();
}
