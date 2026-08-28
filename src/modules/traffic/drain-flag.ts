/**
 * Inbox dirty flag — STOR during an in-flight import must not be lost.
 * Lives on globalThis (Next.js multi-bundle).
 */

const KEY = "__reg_cdr_inbox_dirty__";

function state(): { dirty: boolean } {
  const g = globalThis as typeof globalThis & {
    [KEY]?: { dirty: boolean };
  };
  if (!g[KEY]) g[KEY] = { dirty: false };
  return g[KEY];
}

export function markCdrInboxDirty(): void {
  state().dirty = true;
}

export function consumeCdrInboxDirty(): boolean {
  const s = state();
  const was = s.dirty;
  s.dirty = false;
  return was;
}
