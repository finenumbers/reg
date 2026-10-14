import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMG_COLUMNS } from "@/modules/smg/columns";

const { createMany } = vi.hoisted(() => ({
  createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: vi.fn(async () => ({ id: "job_smg" })),
      update: vi.fn(async () => ({})),
    },
    jobRunArtifact: {
      upsert: vi.fn(async () => ({})),
    },
    smgCdrRecord: {
      createMany: (...args: unknown[]) => createMany(args[0] as { data: unknown[] }),
    },
  },
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    SMG_IMPORT_MANUAL: "smg.import_manual",
    SMG_IMPORT_START: "smg.import_start",
    SMG_IMPORT_FINISH: "smg.import_finish",
  },
  auditService: { append: vi.fn(async () => {}) },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { auditService } from "@/modules/audit";
import { ageSmgInboxFile, processSmgImport } from "@/modules/smg/import-processor";
import { listSmgPoisonEntries } from "@/modules/smg/poison";

const BANNER = "SMG1016M. CDR. File started at '20261013120000'";

function headerLine(): string {
  return `${SMG_COLUMNS.slice(0, 50)
    .map((column) => column.header)
    .join(";")};`;
}

function dataLine(patch: Record<string, string>): string {
  const values = SMG_COLUMNS.slice(0, 50).map((column) => patch[column.field] ?? "");
  return `${values.join(";")};`;
}

const CALL = {
  deviceSign: "mts",
  setupTime: "2026-10-13 11:59:00",
  disconnectTime: "2026-10-13 12:00:00",
  uniqueTag: "tag-1",
};

describe("processSmgImport", () => {
  let inbox: string;
  const previous = process.env.CDR_INBOX_DIR;

  beforeEach(async () => {
    inbox = await mkdtemp(path.join(tmpdir(), "smg-inbox-"));
    await mkdir(path.join(inbox, "smg"));
    process.env.CDR_INBOX_DIR = inbox;
    createMany.mockClear();
  });

  afterEach(async () => {
    if (previous == null) delete process.env.CDR_INBOX_DIR;
    else process.env.CDR_INBOX_DIR = previous;
    await rm(inbox, { recursive: true, force: true });
  });

  async function put(name: string, body: string, aged = true): Promise<string> {
    const abs = path.join(inbox, "smg", name);
    await writeFile(abs, body, "utf8");
    if (aged) await ageSmgInboxFile(abs);
    return abs;
  }

  it("deletes a clean file and a header-only file", async () => {
    const clean = await put(
      "20261013120000.cdr",
      [BANNER, headerLine(), dataLine(CALL)].join("\n"),
    );
    const empty = await put("20261013.cdr", `${BANNER}\n${headerLine()}\n`);
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.status).toBe("success");
    expect(result.phonesParsed).toBe(1);
    expect(result.requeueAfterMs).toBeUndefined();
    await expect(readFile(clean)).rejects.toThrow();
    await expect(readFile(empty)).rejects.toThrow();
    expect(listSmgPoisonEntries()).toEqual([]);
  });

  it("inserts good rows, keeps a partial file, and poisons it", async () => {
    const abs = await put(
      "20261013120100.cdr",
      [
        BANNER,
        headerLine(),
        dataLine(CALL),
        dataLine({ ...CALL, deviceSign: "", uniqueTag: "tag-2" }),
      ].join("\n"),
    );
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.status).toBe("failed");
    expect(result.phonesParsed).toBe(1);
    expect(result.linesBad).toBe(1);
    expect(result.errorMessage).toMatch(/Частичная загрузка/);
    await expect(readFile(abs, "utf8")).resolves.toContain("tag-2");
    expect(listSmgPoisonEntries()[0]?.error).toMatch(/Частичная загрузка/);
    expect(prisma.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringMatching(/20261013120100\.cdr/),
          meta: { files: ["20261013120100.cdr"], fileCount: 1 },
        }),
      }),
    );
    expect(auditService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "smg.import_finish",
        meta: expect.objectContaining({
          status: "failed",
          fileCount: 1,
          files: ["20261013120100.cdr"],
          phonesParsed: 1,
          linesBad: 1,
        }),
      }),
    );
  });

  it("keeps an unexpected name and does not insert it", async () => {
    const abs = await put("notes.txt", "hello");
    await processSmgImport({ trigger: "schedule" });
    await expect(readFile(abs, "utf8")).resolves.toBe("hello");
    expect(createMany).not.toHaveBeenCalled();
    expect(listSmgPoisonEntries()[0]?.error).toMatch(/Неожиданное имя/);
  });

  it("leaves a young file in place and asks for another pass", async () => {
    const abs = await put(
      "20261013120200.cdr",
      [BANNER, headerLine(), dataLine(CALL)].join("\n"),
      false,
    );
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.phonesParsed).toBe(0);
    expect(result.requeueAfterMs).toBe(2000);
    await expect(readFile(abs, "utf8")).resolves.toContain("tag-1");
    expect(listSmgPoisonEntries()).toEqual([]);
  });
});
