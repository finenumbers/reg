import { beforeEach, describe, expect, it, vi } from "vitest";

const jobRunCreate = vi.fn();
const jobRunUpdate = vi.fn();
const jobRunUpdateMany = vi.fn();
const auditAppend = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: (...args: unknown[]) => jobRunCreate(...args),
      update: (...args: unknown[]) => jobRunUpdate(...args),
      updateMany: (...args: unknown[]) => jobRunUpdateMany(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    DB_VACUUM_START: "db.vacuum_start",
    DB_VACUUM_FINISH: "db.vacuum_finish",
  },
  auditService: { append: (...args: unknown[]) => auditAppend(...args) },
}));

import { processDatabaseVacuum } from "@/modules/storage/vacuum/processor";
import {
  DATABASE_VACUUM_SQL,
  VACUUM_LOCK_TIMEOUT_SQL,
  VACUUM_STATEMENT_TIMEOUT_SQL,
  VACUUM_TABLE_ORDER,
} from "@/modules/storage/vacuum/sql";

describe("processDatabaseVacuum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobRunCreate.mockResolvedValue({ id: "vac-1" });
    jobRunUpdate.mockResolvedValue({});
    jobRunUpdateMany.mockResolvedValue({ count: 0 });
    auditAppend.mockResolvedValue(undefined);
  });

  it("runs the two VACUUM FULL statements in order and does not delete rows", async () => {
    const queries: string[] = [];
    let ended = false;
    const result = await processDatabaseVacuum({ trigger: "manual" }, async () => ({
      query: async (sql: string) => {
        queries.push(sql);
      },
      end: async () => {
        ended = true;
      },
    }));
    expect(result.status).toBe("success");
    expect(queries).toEqual([
      VACUUM_STATEMENT_TIMEOUT_SQL,
      VACUUM_LOCK_TIMEOUT_SQL,
      ...VACUUM_TABLE_ORDER.map((id) => DATABASE_VACUUM_SQL[id]),
    ]);
    expect(queries.join("\n")).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/i);
    expect(ended).toBe(true);
    const success = jobRunUpdate.mock.calls
      .map((call) => call[0] as { data?: { status?: string; errorMessage?: string } })
      .find((call) => call.data?.status === "success");
    expect(success?.data?.errorMessage).toMatch(/Живые строки сохранены/);
  });

  it("records a lock timeout on the current table and still closes the client", async () => {
    let ended = false;
    const result = await processDatabaseVacuum({ trigger: "manual" }, async () => ({
      query: async (sql: string) => {
        if (sql.startsWith("VACUUM")) {
          throw new Error("canceling statement due to lock timeout");
        }
      },
      end: async () => {
        ended = true;
      },
    }));
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Ссылки VoIPmonitor/);
    expect(result.errorMessage).toMatch(/занята другим запросом/);
    expect(ended).toBe(true);
  });
});
