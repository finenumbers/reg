import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, traceFindMany, nodeFindFirst } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  traceFindMany: vi.fn(),
  nodeFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    smgCdrRecord: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
    smgCallTrace: {
      findMany: (...args: unknown[]) => traceFindMany(...args),
    },
    smgSyslogNode: {
      findFirst: (...args: unknown[]) => nodeFindFirst(...args),
    },
  },
}));

import { lookupSmgTrace } from "@/modules/smg-trace/lookup";

describe("lookupSmgTrace", () => {
  beforeEach(() => {
    findUnique.mockReset();
    traceFindMany.mockReset();
    nodeFindFirst.mockReset();
    nodeFindFirst.mockResolvedValue(null);
    traceFindMany.mockResolvedValue([]);
  });

  it("does not load the card when the node is off", async () => {
    findUnique.mockResolvedValue({
      uniqueTag: "1100004f00000001",
      radiusSessionId: "",
      deviceSign: "Kazan",
    });
    nodeFindFirst.mockResolvedValue({ ip: "10.0.0.8" });

    await expect(lookupSmgTrace("cdr-1")).resolves.toEqual({ status: "noAntifraud" });
    expect(traceFindMany).not.toHaveBeenCalled();
    expect(nodeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { antifraudEnabled: false, identifier: "kazan" },
      }),
    );
  });

  it("still loads the card when the node is on", async () => {
    findUnique.mockResolvedValue({
      uniqueTag: "1100004f00000001",
      radiusSessionId: "",
      deviceSign: "kazan",
    });
    traceFindMany.mockResolvedValue([
      {
        deviceIp: "10.0.0.8",
        open: false,
        callref: "1",
        blocks: { text: "Set Antifraud" },
      },
    ]);

    await expect(lookupSmgTrace("cdr-1")).resolves.toMatchObject({
      status: "ok",
      blocks: { text: "Set Antifraud" },
    });
    expect(traceFindMany).toHaveBeenCalled();
  });
});
