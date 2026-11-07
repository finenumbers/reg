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

vi.mock("@/modules/rtu/screen-publish", () => ({
  requestRtuScreenPublish: vi.fn(async () => ({ published: true })),
}));

vi.mock("@/modules/audit", () => ({
  AUDIT_ACTIONS: {
    PHONES_SYNC_MANUAL: "phones.sync_manual",
    PHONES_SYNC_START: "phones.sync_start",
    PHONES_SYNC_FINISH: "phones.sync_finish",
  },
  auditService: {
    append: (...args: unknown[]) => appendAudit(...args),
  },
}));

import { processPhonesSync } from "@/modules/phones/phones-sync-processor";
import { ENDPOINT_HEADERS, GATEWAY_HEADERS } from "@/modules/phones/types";

function payload(endpoints: number, gateways: number) {
  return {
    version: 2,
    endpointHeaders: [...ENDPOINT_HEADERS],
    gatewayHeaders: [...GATEWAY_HEADERS],
    endpoints: Array.from({ length: endpoints }, (_, index) => ({
      name: `e${index}`,
      endpointNumber: String(index),
      data: { Название: `e${index}`, "Регистрационный пароль": "secret" },
    })),
    gateways: Array.from({ length: gateways }, (_, index) => ({
      name: `g${index}`,
      data: { Название: `g${index}` },
    })),
  };
}

describe("processPhonesSync", () => {
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

  it("replaces the catalog and does not store a SOAP body", async () => {
    const apply = vi.fn().mockResolvedValue({ endpointCount: 1, gatewayCount: 1 });
    const result = await processPhonesSync(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: true, payload: payload(1, 1) }),
        apply,
        catalog: async () => ({ endpoints: [{ Название: "old" }], gateways: [] }),
      },
    );
    expect(result.status).toBe("success");
    expect(result.endpointCount).toBe(1);
    expect(apply).toHaveBeenCalledWith(payload(1, 1), "job-1", expect.any(Date));
    const stored = JSON.stringify(updateJobRun.mock.calls);
    expect(stored).not.toContain("Envelope");
    expect(stored).not.toContain("selectRowset");
    expect(stored).not.toContain("secret");
  });

  it("does not wipe a live catalog with an empty read", async () => {
    const apply = vi.fn();
    const result = await processPhonesSync(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: true, payload: payload(0, 0) }),
        apply,
        catalog: async () => ({ endpoints: [{ Название: "old" }], gateways: [] }),
      },
    );
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Пустой снимок");
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not apply a snapshot that drops every endpoint", async () => {
    const apply = vi.fn();
    const result = await processPhonesSync(
      { trigger: "schedule" },
      {
        read: async () => ({ ok: true, payload: payload(0, 1) }),
        apply,
        catalog: async () => ({
          endpoints: [{ Название: "old" }],
          gateways: [{ Название: "g" }],
        }),
      },
    );
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("оконечн");
    expect(apply).not.toHaveBeenCalled();
  });
});
