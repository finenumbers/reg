import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn();
const jobRunCreate = vi.fn();
const jobRunUpdate = vi.fn();
const appSettingFind = vi.fn();
const appSettingUpdate = vi.fn();
const phoneFindMany = vi.fn();
const phoneImportFind = vi.fn();
const listInbox = vi.fn();
const isInFlight = vi.fn();
const auditAppend = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    jobRun: {
      create: (...args: unknown[]) => jobRunCreate(...args),
      update: (...args: unknown[]) => jobRunUpdate(...args),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    appSetting: {
      findUnique: (...args: unknown[]) => appSettingFind(...args),
      update: (...args: unknown[]) => appSettingUpdate(...args),
    },
    phoneEndpoint: {
      findMany: (...args: unknown[]) => phoneFindMany(...args),
    },
    phoneImportState: {
      findUnique: (...args: unknown[]) => phoneImportFind(...args),
    },
  },
}));

vi.mock("@/modules/jobs/runtime", () => ({
  jobRuntime: { isInFlight: (...args: unknown[]) => isInFlight(...args) },
}));

vi.mock("@/modules/traffic/inbox", () => ({
  listInboxFiles: (...args: unknown[]) => listInbox(...args),
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    CDR_SIDES_REFRESH_MANUAL: "cdr.sides.refresh_manual",
    CDR_SIDES_REFRESH_START: "cdr.sides.refresh_start",
    CDR_SIDES_REFRESH_FINISH: "cdr.sides.refresh_finish",
  },
  auditService: { append: (...args: unknown[]) => auditAppend(...args) },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processCdrSidesRefresh } from "@/modules/traffic/sides-refresh/processor";

describe("processCdrSidesRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInFlight.mockReturnValue(false);
    listInbox.mockResolvedValue([]);
    jobRunCreate.mockResolvedValue({ id: "job-1" });
    jobRunUpdate.mockResolvedValue({});
    appSettingUpdate.mockResolvedValue({});
    phoneImportFind.mockResolvedValue({
      lastSyncedAt: new Date("2026-08-31T11:00:00.000Z"),
    });
  });

  it("skips without a job row when import is in flight", async () => {
    isInFlight.mockImplementation((code: string) => code === "cdr.import");
    const result = await processCdrSidesRefresh({ trigger: "schedule" });
    expect(result.skipped).toBe(true);
    expect(result.status).toBe("success");
    expect(jobRunCreate).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("skips without a job row when the CDR inbox has pending files", async () => {
    listInbox.mockResolvedValue([{ filename: "20260831_112520" }]);
    const result = await processCdrSidesRefresh({ trigger: "schedule" });
    expect(result.skipped).toBe(true);
    expect(jobRunCreate).not.toHaveBeenCalled();
  });

  it("fails closed on an empty description map and does not write the snapshot", async () => {
    phoneFindMany.mockResolvedValue([]);
    const result = await processCdrSidesRefresh({ trigger: "schedule" });
    expect(result.status).toBe("failed");
    expect(appSettingUpdate).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(jobRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("updates sides, writes the snapshot, and does not replay when catalog is stable", async () => {
    phoneFindMany.mockResolvedValue([
      {
        endpointNumber: "73915190530",
        name: "TeleZon_73915190530",
        data: { Описание: "Сафетель" },
      },
    ]);
    appSettingFind.mockResolvedValue({
      cdrSidesRefreshMap: null,
      cdrSidesRefreshCatalogAt: null,
    });
    executeRaw.mockResolvedValue(4);

    const result = await processCdrSidesRefresh({ trigger: "schedule" });
    expect(result.status).toBe("success");
    expect(result.replay).toBe(false);
    expect(result.phonesParsed).toBe(1);
    expect(result.changesCount).toBe(8);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(appSettingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cdrSidesRefreshMap: { "73915190530": "Сафетель" },
        }),
      }),
    );
  });

  it("does not save the snapshot and asks for replay when catalog moved", async () => {
    phoneFindMany.mockResolvedValue([
      {
        endpointNumber: "73915190530",
        name: "TeleZon",
        data: { Описание: "Сафетель" },
      },
    ]);
    appSettingFind.mockResolvedValue({
      cdrSidesRefreshMap: null,
      cdrSidesRefreshCatalogAt: null,
    });
    executeRaw.mockResolvedValue(1);
    phoneImportFind
      .mockResolvedValueOnce({ lastSyncedAt: new Date("2026-08-31T11:00:00.000Z") })
      .mockResolvedValueOnce({ lastSyncedAt: new Date("2026-08-31T11:05:00.000Z") });

    const result = await processCdrSidesRefresh({ trigger: "schedule" });
    expect(result.replay).toBe(true);
    expect(appSettingUpdate).not.toHaveBeenCalled();
  });
});
