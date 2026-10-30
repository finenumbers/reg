import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyTraceState, SMG_TRACE_PARSER_VERSION } from "@/modules/smg-trace/assemble";
import {
  LIVE_FILE_KEY,
  stepDevice,
  tailPresence,
  type TraceRepository,
} from "@/modules/smg-trace/walk";

const FILE_KEY = "10.1.2.3/2026/10/31/03/00";

function mark() {
  return {
    floor: FILE_KEY,
    tail: { key: FILE_KEY, offset: 0, rawSize: 1 },
    slotIndex: 0,
    slotKey: FILE_KEY,
    state: emptyTraceState(),
    fileStart: null,
    fileStartKey: null,
  };
}

function repo(initial: unknown): { saved: () => unknown; calls: number; api: TraceRepository } {
  let state = initial;
  let calls = 0;
  return {
    saved: () => state,
    get calls() {
      return calls;
    },
    api: {
      async loadCheckpointMeta() {
        return [{ fileKey: LIVE_FILE_KEY, size: 0, version: SMG_TRACE_PARSER_VERSION }];
      },
      async loadCheckpointState() {
        return state;
      },
      async deleteStaleCheckpoints() {},
      async deleteCards() {},
      async saveSpan() {},
      async saveCheckpoint(_deviceIp, _fileKey, _size, next) {
        calls += 1;
        state = next;
      },
    },
  };
}

describe("tailPresence", () => {
  it("sees a raw log, a missing slot, and a path that is not a directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "smg-tail-"));
    const dir = path.join(root, "10.1.2.3", "2026", "10", "31", "03");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "00.log"), "x");
    expect(tailPresence(root, FILE_KEY)).toBe("present");

    const gone = "10.1.2.3/2026/10/31/03/10";
    expect(tailPresence(root, gone)).toBe("absent");

    await writeFile(path.join(root, "10.9.9.9"), "not-a-directory");
    expect(tailPresence(root, "10.9.9.9/2026/10/31/03/00")).toBe("unreadable");
    expect(tailPresence(root, "../etc/passwd")).toBe("unreadable");
  });
});

describe("stepDevice missing slot", () => {
  it("closes a slot that is really gone and keeps one that is still on disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "smg-step-"));
    const dir = path.join(root, "10.1.2.3", "2026", "10", "31", "03");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "00.log"), "still-here");

    const present = repo(mark());
    await expect(stepDevice("10.1.2.3", [], present.api, { root })).resolves.toBe(false);
    expect(present.calls).toBe(0);
    expect(present.saved()).toEqual(mark());

    const absentRoot = await mkdtemp(path.join(tmpdir(), "smg-step-gone-"));
    const gone = repo(mark());
    await expect(stepDevice("10.1.2.3", [], gone.api, { root: absentRoot })).resolves.toBe(true);
    expect(gone.calls).toBe(1);
    expect((gone.saved() as { tail: unknown }).tail).toBeNull();
  });
});
