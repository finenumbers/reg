const KEY = "__reg_smg_inbox_dirty__";

function state(): { dirty: boolean } {
  const g = globalThis as typeof globalThis & {
    [KEY]?: { dirty: boolean };
  };
  if (!g[KEY]) g[KEY] = { dirty: false };
  return g[KEY];
}

export function markSmgInboxDirty(): void {
  state().dirty = true;
}

export function consumeSmgInboxDirty(): boolean {
  const current = state();
  const was = current.dirty;
  current.dirty = false;
  return was;
}

/** Enqueue inbox drain — never throws. Marks dirty so an in-flight run will loop. */
export function requestSmgImportDrain(trigger: "schedule" | "manual"): void {
  markSmgInboxDirty();
  void import("@/modules/jobs/runtime").then(({ jobRuntime }) =>
    jobRuntime.enqueue({ actionCode: "smg.import", trigger }),
  );
}
