import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, upsert, queryRaw } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: { findUnique },
    vatsNameList: { upsert, update: vi.fn(), findUnique: vi.fn() },
    $queryRaw: queryRaw,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        appSetting: { findUnique },
        vatsNameList: { upsert, update: vi.fn() },
        $queryRaw: queryRaw,
      }),
  },
}));

import { requestVatsRestart, vatsGeneration } from "@/modules/vats/control";
import { createPrismaCycleStore } from "@/modules/vats/store";

describe("VATS snapshot commit", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    queryRaw.mockReset();
  });

  it("does not commit a snapshot for a different host", async () => {
    findUnique.mockResolvedValue({ vatsBossBaseUrl: "https://new.example" });
    const store = createPrismaCycleStore("https://old.example", vatsGeneration());
    const outcome = await store.commitDomains({
      rows: [
        {
          name: "a.example",
          client: null,
          clientAt: null,
          accountsCount: null,
          accountsLimit: null,
          dialplan: null,
          frozen: null,
        },
      ],
      notice: null,
      cardReadAt: {},
      generation: vatsGeneration(),
    });
    expect(outcome).toBe("skipped");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does not commit after settings were saved", async () => {
    const generation = vatsGeneration();
    const store = createPrismaCycleStore("https://platform.example", generation);
    requestVatsRestart();
    findUnique.mockResolvedValue({ vatsBossBaseUrl: "https://platform.example" });
    const outcome = await store.commitTelnums({
      rows: [],
      notice: null,
      generation,
    });
    expect(outcome).toBe("skipped");
    expect(upsert).not.toHaveBeenCalled();
  });
});
