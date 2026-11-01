import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  TABLE_EXPORT_DIR_PREFIX,
  beginTableExportJob,
  cancelTableExportJob,
  readTableExportFile,
  readTableExportJob,
  resetTableExportJobsForTests,
  type TableExportRequest,
} from "@/modules/table-export/job";
import { TableExportCancelled } from "@/modules/table-export/xlsx-stream";

const request: TableExportRequest = { kind: "free", filters: {}, phoneQ: "" };

afterEach(() => {
  resetTableExportJobsForTests();
});

async function waitFor(
  id: string,
  userId: string,
  done: (status: string) => boolean,
): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const job = readTableExportJob("free", id, userId);
    if (job && done(job.status)) return job.status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("export job did not settle");
}

describe("table export jobs", () => {
  it("hides another user's status and file", async () => {
    const started = beginTableExportJob(
      { actorUserId: "owner", clientIp: null, filename: "free.xlsx", request },
      async () => {},
    );
    expect(started).not.toBe("busy");
    if (started === "busy") return;
    await waitFor(started.id, "owner", (status) => status === "completed");
    expect(readTableExportJob("free", started.id, "other")).toBeNull();
    expect(readTableExportFile("free", started.id, "other")).toBeNull();
    expect(readTableExportJob("free", started.id, "owner")?.status).toBe("completed");
  });

  it("keeps the slot while a build is running", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = beginTableExportJob(
      { actorUserId: "owner", clientIp: null, filename: "free.xlsx", request },
      async () => {
        await gate;
      },
    );
    expect(started).not.toBe("busy");
    const second = beginTableExportJob(
      { actorUserId: "other", clientIp: null, filename: "free.xlsx", request },
      async () => {},
    );
    expect(second).toBe("busy");
    release();
    if (started === "busy") return;
    await waitFor(started.id, "owner", (status) => status === "completed");
  });

  it("deletes the partial file when the owner cancels", async () => {
    const before = new Set(
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith(TABLE_EXPORT_DIR_PREFIX),
      ),
    );
    const started = beginTableExportJob(
      { actorUserId: "owner", clientIp: null, filename: "free.xlsx", request },
      async (ctx) => {
        await new Promise<void>((_resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new TableExportCancelled());
            return;
          }
          ctx.signal.addEventListener("abort", () => reject(new TableExportCancelled()), {
            once: true,
          });
        });
      },
    );
    expect(started).not.toBe("busy");
    if (started === "busy") return;
    for (let i = 0; i < 50; i++) {
      const names = (await readdir(tmpdir())).filter((name) =>
        name.startsWith(TABLE_EXPORT_DIR_PREFIX),
      );
      if (names.some((name) => !before.has(name))) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(cancelTableExportJob("free", started.id, "owner")).toBe("cancelled");
    expect(cancelTableExportJob("free", started.id, "other")).toBe("missing");
    await waitFor(started.id, "owner", (status) => status === "cancelled");
    for (let i = 0; i < 50; i++) {
      const names = (await readdir(tmpdir())).filter((name) =>
        name.startsWith(TABLE_EXPORT_DIR_PREFIX),
      );
      if (names.every((name) => before.has(name))) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("cancelled export left a temp directory");
  });
});
