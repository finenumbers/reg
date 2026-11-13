import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

import { loadOprsMarkingSnapshot } from "@/modules/oprs/marking-snapshot";

describe("loadOprsMarkingSnapshot", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("shares one catalog read and reads again after that read finishes", async () => {
    let release: (rows: unknown[]) => void = () => {};
    queryRaw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = loadOprsMarkingSnapshot();
    const second = loadOprsMarkingSnapshot();
    release([]);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    queryRaw.mockResolvedValueOnce([]);
    await loadOprsMarkingSnapshot();
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
