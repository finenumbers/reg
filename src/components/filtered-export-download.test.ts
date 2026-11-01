import { describe, expect, it } from "vitest";
import {
  noteRestoredExportJob,
  takeAutoDownload,
} from "@/components/filtered-export-download";

function gate() {
  return {
    downloadedFor: { current: null as string | null },
    skipToast: { current: null as string | null },
  };
}

describe("catalog export download gate", () => {
  it("does not save a completed job restored with the page", () => {
    const state = gate();
    const job = { id: "done", status: "completed" };
    noteRestoredExportJob(job, state.downloadedFor, state.skipToast);
    expect(state.skipToast.current).toBe("done:completed");
    expect(takeAutoDownload(job, state.downloadedFor)).toBe(false);
  });

  it("remembers a failed restore without treating it as a file", () => {
    const state = gate();
    const job = { id: "bad", status: "failed" };
    noteRestoredExportJob(job, state.downloadedFor, state.skipToast);
    expect(state.skipToast.current).toBe("bad:failed");
    expect(state.downloadedFor.current).toBeNull();
    expect(takeAutoDownload(job, state.downloadedFor)).toBe(false);
  });

  it("saves once when a running job becomes ready on this visit", () => {
    const state = gate();
    const running = { id: "live", status: "running" };
    noteRestoredExportJob(running, state.downloadedFor, state.skipToast);
    expect(state.downloadedFor.current).toBeNull();
    expect(state.skipToast.current).toBeNull();
    expect(takeAutoDownload(running, state.downloadedFor)).toBe(false);
    const ready = { id: "live", status: "completed" };
    expect(takeAutoDownload(ready, state.downloadedFor)).toBe(true);
    expect(takeAutoDownload(ready, state.downloadedFor)).toBe(false);
  });

  it("ignores an empty restore", () => {
    const state = gate();
    noteRestoredExportJob(null, state.downloadedFor, state.skipToast);
    expect(state.downloadedFor.current).toBeNull();
    expect(state.skipToast.current).toBeNull();
    expect(takeAutoDownload(null, state.downloadedFor)).toBe(false);
  });
});
