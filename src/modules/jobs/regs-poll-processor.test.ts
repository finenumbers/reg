import { beforeEach, describe, expect, it, vi } from "vitest";

const createJobRun = vi.fn();
const updateJobRun = vi.fn();
const updateManyJobRun = vi.fn();
const appendAudit = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobRun: {
      create: (...args: unknown[]) => createJobRun(...args),
      update: (...args: unknown[]) => updateJobRun(...args),
      updateMany: (...args: unknown[]) => updateManyJobRun(...args),
    },
  },
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    REGS_POLL_MANUAL: "regs.poll_manual",
    REGS_POLL_START: "regs.poll_start",
    REGS_POLL_FINISH: "regs.poll_finish",
  },
  auditService: {
    append: (...args: unknown[]) => appendAudit(...args),
  },
}));

import { processRegsPoll } from "@/modules/jobs/regs-poll-processor";

const live = {
  id: "1",
  name: "100",
  aliases: "",
  state: "Зарегистрирован",
  address: "1.2.3.4:5060",
};

describe("processRegsPoll", () => {
  beforeEach(() => {
    createJobRun.mockReset();
    updateJobRun.mockReset();
    updateManyJobRun.mockReset();
    appendAudit.mockReset();
    createJobRun.mockResolvedValue({ id: "job-1" });
    updateJobRun.mockResolvedValue({});
    updateManyJobRun.mockResolvedValue({ count: 0 });
    appendAudit.mockResolvedValue(undefined);
  });

  it("refuses an empty page when the local table already has rows", async () => {
    const apply = vi.fn();
    const result = await processRegsPoll(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: true, pcomm: [], pupr: [] }),
        loadCatalog: async () => ({ ok: true, rows: [] }),
        countCurrent: async () => 3,
        apply,
      },
    );
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Пустой снимок отклонён");
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not apply an unmapped name or pages that share no id", async () => {
    const apply = vi.fn();
    const unmapped = await processRegsPoll(
      { trigger: "schedule" },
      {
        read: async () => ({
          ok: true,
          pcomm: [{ ...live, name: "office" }],
          pupr: [],
        }),
        loadCatalog: async () => ({ ok: true, rows: [] }),
        countCurrent: async () => 0,
        apply,
      },
    );
    expect(unmapped.status).toBe("failed");
    const overlap = await processRegsPoll(
      { trigger: "schedule" },
      {
        read: async () => ({
          ok: true,
          pcomm: [live],
          pupr: [{ id: "9", userAgent: "Phone" }],
        }),
        loadCatalog: async () => ({ ok: true, rows: [] }),
        countCurrent: async () => 0,
        apply,
      },
    );
    expect(overlap.errorMessage).toBe("Страницы регистраций не соединяются по ID.");
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies the user agent and enqueues geo without storing a body", async () => {
    const apply = vi.fn().mockResolvedValue({ changesCount: 1, removed: 0 });
    const enqueueGeoEnrich = vi.fn();
    const result = await processRegsPoll(
      { trigger: "schedule" },
      {
        read: async () => ({
          ok: true,
          pcomm: [live],
          pupr: [{ id: "1", userAgent: "Yealink" }],
        }),
        loadCatalog: async () => ({ ok: true, rows: [] }),
        countCurrent: async () => 0,
        apply,
        enqueueGeoEnrich,
      },
    );
    expect(result).toMatchObject({
      status: "success",
      phonesParsed: 1,
      linesBad: 0,
      exitCode: null,
    });
    expect(apply).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          phone: "100",
          userAgent: "Yealink",
          ip: "1.2.3.4",
        }),
      ],
      "job-1",
      expect.any(Date),
    );
    expect(enqueueGeoEnrich).toHaveBeenCalledWith(["1.2.3.4"]);
    const stored = JSON.stringify(updateJobRun.mock.calls);
    expect(stored).not.toContain("Envelope");
    expect(stored).not.toContain("selectRowset");
  });

  it("does not apply when the catalog cannot be read", async () => {
    const apply = vi.fn();
    const result = await processRegsPoll(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: true, pcomm: [live], pupr: [] }),
        loadCatalog: async () => ({
          ok: false,
          detail: "Каталог телефонных номеров не прочитан.",
        }),
        countCurrent: async () => 0,
        apply,
      },
    );
    expect(result.errorMessage).toBe("Каталог телефонных номеров не прочитан.");
    expect(apply).not.toHaveBeenCalled();
  });
});
