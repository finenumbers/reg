import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CDR_COLUMNS } from "@/modules/traffic/columns";

const createJobRun = vi.fn();
const updateJobRun = vi.fn();
const upsertArtifact = vi.fn();
const findUniqueSettings = vi.fn();
const createManyCdr = vi.fn();
const appendAudit = vi.fn();
const loadEnrich = vi.fn();
const backfillEnrich = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: (...args: unknown[]) => createJobRun(...args),
      update: (...args: unknown[]) => updateJobRun(...args),
    },
    jobRunArtifact: {
      upsert: (...args: unknown[]) => upsertArtifact(...args),
    },
    appSetting: {
      findUnique: (...args: unknown[]) => findUniqueSettings(...args),
    },
    cdrRecord: {
      createMany: (...args: unknown[]) => createManyCdr(...args),
    },
  },
}));

vi.mock("@/modules/traffic/enrich-import", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/traffic/enrich-import")>();
  return {
    ...actual,
    loadCdrImportEnrichment: (...args: unknown[]) => loadEnrich(...args),
    backfillUnenrichedCdrRecords: (...args: unknown[]) => backfillEnrich(...args),
  };
});

vi.mock("@/modules/traffic/sync-cdr-at", () => ({
  syncCdrAtFromCdrDate: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    CDR_IMPORT_MANUAL: "cdr.import_manual",
    CDR_IMPORT_START: "cdr.import_start",
    CDR_IMPORT_FINISH: "cdr.import_finish",
  },
  auditService: {
    append: (...args: unknown[]) => appendAudit(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { processCdrImport } from "@/modules/traffic/cdr-import-processor";
import { isPoisoned } from "@/modules/traffic/poison";

const HEADER = CDR_COLUMNS.map((col) => `"${col}"`).join(";");

function dumpPath(dir: string, name: string): string {
  return path.join(dir, name);
}

describe("processCdrImport empty-minute dumps", () => {
  let inboxDir = "";
  const prevInbox = process.env.CDR_INBOX_DIR;

  beforeEach(async () => {
    vi.clearAllMocks();
    inboxDir = await mkdtemp(path.join(tmpdir(), "cdr-inbox-"));
    process.env.CDR_INBOX_DIR = inboxDir;
    createJobRun.mockResolvedValue({ id: "job_1" });
    updateJobRun.mockResolvedValue({});
    upsertArtifact.mockResolvedValue({});
    findUniqueSettings.mockResolvedValue({ displayTimezone: "Europe/Moscow" });
    createManyCdr.mockResolvedValue({ count: 0 });
    appendAudit.mockResolvedValue(undefined);
    loadEnrich.mockResolvedValue({
      descriptions: new Map(),
      pstn: new Map(),
      geo: new Map(),
      stats: {
        pstnCacheHits: 0,
        pstnLiveLookups: 0,
        geoCacheHits: 0,
        geoLiveLookups: 0,
      },
    });
    backfillEnrich.mockResolvedValue({
      backfilled: 0,
      remaining: 0,
      aborted: false,
      stats: {
        pstnCacheHits: 0,
        pstnLiveLookups: 0,
        geoCacheHits: 0,
        geoLiveLookups: 0,
      },
    });
  });

  afterEach(async () => {
    if (prevInbox === undefined) delete process.env.CDR_INBOX_DIR;
    else process.env.CDR_INBOX_DIR = prevInbox;
    if (inboxDir) await rm(inboxDir, { recursive: true, force: true });
    inboxDir = "";
  });

  it("treats a header-only dump as success and deletes the file", async () => {
    const file = dumpPath(inboxDir, "20260828_142001");
    await writeFile(file, `${HEADER}\n`, "utf8");

    const result = await processCdrImport({ trigger: "test" });

    expect(result.status).toBe("success");
    expect(result.errorMessage).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    expect(loadEnrich).not.toHaveBeenCalled();
    expect(backfillEnrich).toHaveBeenCalled();
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "success", errorMessage: null }),
      }),
    );
  });

  it("treats a header plus blank lines as success", async () => {
    const file = dumpPath(inboxDir, "20260828_142601");
    await writeFile(file, `${HEADER}\n\n`, "utf8");

    const result = await processCdrImport({ trigger: "test" });

    expect(result.status).toBe("success");
    expect(result.errorMessage).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it("fails a zero-byte file and keeps it", async () => {
    const file = dumpPath(inboxDir, "20260828_150001");
    await writeFile(file, "", "utf8");

    const result = await processCdrImport({ trigger: "test" });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Файл пустой: 20260828_150001/);
    expect(existsSync(file)).toBe(true);
    expect(isPoisoned("20260828_150001", statSync(file).mtimeMs)).toBe(true);
  });

  it("fails a dump with only invalid data rows and keeps it", async () => {
    const file = dumpPath(inboxDir, "20260828_151001");
    await writeFile(file, `${HEADER}\n"too";"few"\n`, "utf8");

    const result = await processCdrImport({ trigger: "test" });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Нет валидных строк в 20260828_151001/);
    expect(existsSync(file)).toBe(true);
  });

  it("deletes an empty minute and fails only the bad file in one run", async () => {
    const emptyFile = dumpPath(inboxDir, "20260828_142001");
    const badFile = dumpPath(inboxDir, "20260828_142601");
    await writeFile(emptyFile, `${HEADER}\n`, "utf8");
    await writeFile(badFile, `${HEADER}\n"too";"few"\n`, "utf8");

    const result = await processCdrImport({ trigger: "test" });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Нет валидных строк в 20260828_142601/);
    expect(result.errorMessage).not.toMatch(/20260828_142001/);
    expect(existsSync(emptyFile)).toBe(false);
    expect(existsSync(badFile)).toBe(true);
    expect(loadEnrich).not.toHaveBeenCalled();
  });
});

function quotedRow(
  overrides: Partial<Record<(typeof CDR_COLUMNS)[number], string>>,
): string {
  return CDR_COLUMNS.map((col) => {
    const raw = overrides[col] ?? (col === "cdr_id" ? "202608270000007910" : "");
    return `"${raw.replaceAll('"', '""')}"`;
  }).join(";");
}

describe("processCdrImport enrich on insert", () => {
  let inboxDir = "";
  const prevInbox = process.env.CDR_INBOX_DIR;

  beforeEach(async () => {
    vi.clearAllMocks();
    inboxDir = await mkdtemp(path.join(tmpdir(), "cdr-inbox-"));
    process.env.CDR_INBOX_DIR = inboxDir;
    createJobRun.mockResolvedValue({ id: "job_1" });
    updateJobRun.mockResolvedValue({});
    upsertArtifact.mockResolvedValue({});
    findUniqueSettings.mockResolvedValue({ displayTimezone: "Europe/Moscow" });
    createManyCdr.mockResolvedValue({ count: 1 });
    appendAudit.mockResolvedValue(undefined);
    loadEnrich.mockResolvedValue({
      descriptions: new Map([["79501112233", "Офис А"]]),
      pstn: new Map([
        [
          "79501112233",
          { found: true, operator: "МТС", garTerritory: "г. Москва" },
        ],
        [
          "78620000000",
          { found: false, operator: null, garTerritory: null },
        ],
      ]),
      geo: new Map([
        [
          "1.2.3.4",
          {
            country: "Россия",
            countryIso: "RU",
            city: "Москва",
            isp: "РТК",
            datasetDate: null,
          },
        ],
      ]),
      stats: {
        pstnCacheHits: 1,
        pstnLiveLookups: 0,
        geoCacheHits: 1,
        geoLiveLookups: 0,
      },
    });
    backfillEnrich.mockResolvedValue({
      backfilled: 0,
      remaining: 0,
      aborted: false,
      stats: {
        pstnCacheHits: 0,
        pstnLiveLookups: 0,
        geoCacheHits: 0,
        geoLiveLookups: 0,
      },
    });
  });

  afterEach(async () => {
    if (prevInbox === undefined) delete process.env.CDR_INBOX_DIR;
    else process.env.CDR_INBOX_DIR = prevInbox;
    if (inboxDir) await rm(inboxDir, { recursive: true, force: true });
    inboxDir = "";
  });

  it("writes enrich fields and enrichedAt on createMany", async () => {
    const file = dumpPath(inboxDir, "20260828_160001");
    await writeFile(
      file,
      `${HEADER}\n${quotedRow({
        cdr_id: "id-enrich-1",
        bill_ani: "79501112233",
        bill_dnis: "78620000000",
        remote_src_sig_address: "1.2.3.4:5060",
      })}\n`,
      "utf8",
    );

    const result = await processCdrImport({ trigger: "test" });

    expect(result.status).toBe("success");
    expect(loadEnrich).toHaveBeenCalledWith(
      expect.arrayContaining(["79501112233", "78620000000"]),
      expect.arrayContaining(["1.2.3.4"]),
    );
    expect(createManyCdr).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          cdrId: "id-enrich-1",
          billAni: "79501112233",
          sideA: "Офис А",
          operatorA: "МТС",
          geographyA: "г. Москва",
          countryA: "RU",
          cityA: "Москва",
          providerA: "РТК",
          enrichedAt: expect.any(Date),
        }),
      ],
      skipDuplicates: true,
    });
    expect(existsSync(file)).toBe(false);
  });
});
