import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const count = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    smgCallTrace: {
      count: (...args: unknown[]) => count(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}));

import {
  collectMonthTraceKeys,
  deleteTraceCards,
} from "@/modules/smg-trace/purge-cards";

const KEPT = "aaaaaaaaaaaaaaaa";
const GONE = "bbbbbbbbbbbbbbbb";

describe("collectMonthTraceKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops a tag that another month still carries", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { id: "m1", unique_tag: KEPT, radius_session_id: "" },
        { id: "m2", unique_tag: GONE, radius_session_id: "" },
      ])
      .mockResolvedValueOnce([{ id: "o1", unique_tag: KEPT, radius_session_id: "" }]);
    await expect(collectMonthTraceKeys(2026, 8)).resolves.toEqual([GONE]);
  });

  it("ignores an empty tag and the zero session id", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        id: "m1",
        unique_tag: "",
        radius_session_id: "aaaaaaaa000000000000000000000000",
      },
    ]);
    await expect(collectMonthTraceKeys(2026, 8)).resolves.toEqual([]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("deleteTraceCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports rows removed", async () => {
    deleteMany.mockResolvedValueOnce({ count: 2 });
    const seen: number[] = [];
    await expect(
      deleteTraceCards([GONE, KEPT], async (done) => {
        seen.push(done);
      }),
    ).resolves.toBe(2);
    expect(seen).toEqual([2]);
  });
});
