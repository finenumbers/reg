import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMG_COLUMNS } from "@/modules/smg/columns";
import { NO_TRACE_LABELS } from "@/modules/smg/row-tokens";

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
      updateMany: vi.fn(async () => ({ count: 0 })),
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
import {
  ageSmgInboxFile,
  processSmgImport,
  setSmgAfterReadForTests,
} from "@/modules/smg/import-processor";
import { listSmgPoisonEntries } from "@/modules/smg/poison";
import {
  resetPurgeTargetForTests,
  setPurgeTargetMonth,
} from "@/modules/traffic/purge/target";
import { beginStor, resetStorGateForTests } from "@/modules/traffic/stor-gate";

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
    resetPurgeTargetForTests();
  });

  afterEach(async () => {
    setSmgAfterReadForTests(null);
    resetStorGateForTests();
    resetPurgeTargetForTests();
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

  it("stores a call with an empty device sign and deletes the file", async () => {
    const abs = await put(
      "20261013120200.cdr",
      [
        BANNER,
        headerLine(),
        dataLine({ ...CALL, deviceSign: "", uniqueTag: "tag-blank" }),
      ].join("\n"),
    );
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.status).toBe("success");
    expect(result.phonesParsed).toBe(1);
    expect(result.linesBad).toBe(0);
    const inserted = createMany.mock.calls.flatMap(
      (call) =>
        (call[0] as { data: { recordKey: string; deviceSign: string }[] }).data,
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.deviceSign).toBe("");
    expect(inserted[0]?.recordKey.startsWith("\u001ftag-blank")).toBe(true);
    await expect(readFile(abs)).rejects.toThrow();
    expect(listSmgPoisonEntries()).toEqual([]);
  });

  it("inserts good rows, keeps a partial file, and poisons it", async () => {
    const abs = await put(
      "20261013120100.cdr",
      [
        BANNER,
        headerLine(),
        dataLine(CALL),
        dataLine({ ...CALL, disconnectTime: "not-a-time", uniqueTag: "tag-2" }),
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

  it("keeps a file whose calls fall in the month being deleted and does not insert them", async () => {
    setPurgeTargetMonth("2026-10");
    const abs = await put(
      "20261013120300.cdr",
      [
        BANNER,
        headerLine(),
        dataLine(CALL),
        dataLine({
          ...CALL,
          uniqueTag: "sept",
          disconnectTime: "2026-09-02 01:00:00",
        }),
      ].join("\n"),
    );
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Отложено: идёт удаление 2026-10/);
    await expect(readFile(abs, "utf8")).resolves.toContain("tag-1");
    const inserted = createMany.mock.calls.flatMap(
      (call) =>
        (
          call[0] as {
            data: {
              disconnectDay: string;
              uniqueTagNorm: string;
              radiusSessionNorm: string;
              afCategory: string | null;
              afStatus: string | null;
            }[];
          }
        ).data,
    );
    expect(inserted.map((row) => row.disconnectDay)).toEqual(["2026-09-02"]);
    expect(inserted[0]).toMatchObject({
      uniqueTagNorm: "",
      radiusSessionNorm: "",
      afCategory: NO_TRACE_LABELS.category,
      afStatus: NO_TRACE_LABELS.status,
    });
    resetPurgeTargetForTests();
  });

  it("does not insert the purge month when import is retried while deletion is still the target", async () => {
    setPurgeTargetMonth("2026-10");
    await put("20261013120400.cdr", [BANNER, headerLine(), dataLine(CALL)].join("\n"));
    await processSmgImport({ trigger: "schedule" });
    createMany.mockClear();
    const { clearSmgPoisonExceptMonthHold } = await import("@/modules/smg/poison");
    clearSmgPoisonExceptMonthHold("2026-10");
    await processSmgImport({ trigger: "manual" });
    expect(createMany).not.toHaveBeenCalled();
    resetPurgeTargetForTests();
  });

  it("leaves a file alone while STOR still has it open", async () => {
    const abs = await put(
      "20261013120500.cdr",
      [BANNER, headerLine(), dataLine(CALL)].join("\n"),
    );
    beginStor(abs);
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.phonesParsed).toBe(0);
    expect(result.requeueAfterMs).toBe(2000);
    expect(createMany).not.toHaveBeenCalled();
    await expect(readFile(abs, "utf8")).resolves.toContain("tag-1");
    expect(listSmgPoisonEntries()).toEqual([]);
  });

  it("does not insert a snapshot that grew during the read", async () => {
    const abs = await put(
      "20261013120600.cdr",
      [BANNER, headerLine(), dataLine(CALL)].join("\n"),
    );
    setSmgAfterReadForTests(async () => {
      await appendFile(abs, "\nmore");
    });
    const result = await processSmgImport({ trigger: "schedule" });
    expect(result.phonesParsed).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    await expect(readFile(abs, "utf8")).resolves.toContain("tag-1");
    expect(listSmgPoisonEntries()).toEqual([]);
  });

  it("reads an empty file once it has bytes and the mtime did not move", async () => {
    const abs = await put("20261013120700.cdr", "");
    const first = await processSmgImport({ trigger: "schedule" });
    expect(first.status).toBe("failed");
    expect(first.errorMessage).toMatch(/Файл пустой/);
    expect(createMany).not.toHaveBeenCalled();
    const seen = await stat(abs);
    await writeFile(abs, [BANNER, headerLine(), dataLine(CALL)].join("\n"), "utf8");
    await utimes(abs, seen.atime, seen.mtime);
    createMany.mockClear();
    const second = await processSmgImport({ trigger: "schedule" });
    expect(second.status).toBe("success");
    expect(second.phonesParsed).toBe(1);
    await expect(readFile(abs)).rejects.toThrow();
  });

  it("imports rows held inside a partial file after that month is no longer the target", async () => {
    setPurgeTargetMonth("2026-10");
    const abs = await put(
      "20261013120800.cdr",
      [
        BANNER,
        headerLine(),
        dataLine(CALL),
        dataLine({ ...CALL, disconnectTime: "not-a-time", uniqueTag: "tag-2" }),
      ].join("\n"),
    );
    const held = await processSmgImport({ trigger: "schedule" });
    expect(held.errorMessage).toMatch(/Отложено: идёт удаление 2026-10/);
    expect(createMany).not.toHaveBeenCalled();
    createMany.mockClear();
    await processSmgImport({ trigger: "schedule" });
    expect(createMany).not.toHaveBeenCalled();
    resetPurgeTargetForTests();
    createMany.mockClear();
    const released = await processSmgImport({ trigger: "schedule" });
    expect(released.phonesParsed).toBe(1);
    const inserted = createMany.mock.calls.flatMap(
      (call) => (call[0] as { data: { recordKey: string }[] }).data,
    );
    expect(inserted).toHaveLength(1);
    await expect(readFile(abs, "utf8")).resolves.toContain("tag-2");
    expect(listSmgPoisonEntries()[0]?.error).toMatch(/Частичная загрузка/);
    expect(listSmgPoisonEntries()[0]?.error).not.toMatch(/Отложено/);
  });
});
