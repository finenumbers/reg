/**
 * In-process enrich runner. One job at a time; overlap is also enforced in DB.
 */

const KEY = "__reg_enrich_pipeline_running__";

function flag(): { running: boolean } {
  const g = globalThis as typeof globalThis & {
    [KEY]?: { running: boolean };
  };
  if (!g[KEY]) g[KEY] = { running: false };
  return g[KEY];
}

export function isEnrichPipelineRunning(): boolean {
  return flag().running;
}

/** Starts the pipeline. Returns false if another run is already in this process. */
export function startEnrichPipeline(run: () => Promise<void>): boolean {
  const state = flag();
  if (state.running) return false;
  state.running = true;
  void run().finally(() => {
    state.running = false;
  });
  return true;
}
