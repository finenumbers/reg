import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

import { nextAttemptAt } from "@/modules/voipmonitor/backoff";
import {
  evidenceIsFalselyParked,
  releaseFalselyParkedMisses,
} from "@/modules/voipmonitor/release-parked";

describe("evidenceIsFalselyParked", () => {
  it("matches only the miss_reason field of a retryable miss", () => {
    expect(
      evidenceIsFalselyParked(
        JSON.stringify({
          miss_reason_seed: "call_id_not_in_index",
          miss_reason: "assigned_elsewhere",
        }),
      ),
    ).toBe(true);
    expect(
      evidenceIsFalselyParked(
        '{"miss_reason": "fallback_ambiguous", "miss_reason_seed": "call_id_not_in_index"}',
      ),
    ).toBe(true);
    expect(
      evidenceIsFalselyParked(
        JSON.stringify({
          miss_reason_seed: "call_id_not_in_index",
          miss_reason: "call_id_not_in_index",
        }),
      ),
    ).toBe(false);
    expect(evidenceIsFalselyParked('{"miss_reason_seed":"assigned_elsewhere"}')).toBe(
      false,
    );
  });
});

describe("releaseFalselyParkedMisses", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    executeRaw.mockReset();
  });

  it("moves a parked batch onto the normal backoff and stops when the update matches nothing", async () => {
    queryRaw.mockResolvedValueOnce([{ cdr_record_id: "cdr_1" }]);
    executeRaw.mockResolvedValueOnce(0);
    await expect(
      releaseFalselyParkedMisses(new Date("2026-10-14T12:00:00.000Z")),
    ).resolves.toBe(0);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("sums rows whose due time moved", async () => {
    queryRaw
      .mockResolvedValueOnce([{ cdr_record_id: "cdr_1" }, { cdr_record_id: "cdr_2" }])
      .mockResolvedValueOnce([]);
    executeRaw.mockResolvedValueOnce(2);
    await expect(releaseFalselyParkedMisses()).resolves.toBe(2);
  });

  it("sets a due time from each attempt count", async () => {
    const now = new Date("2026-10-14T12:00:00.000Z");
    queryRaw
      .mockResolvedValueOnce([
        { cdr_record_id: "cdr_1", attempt_count: 1 },
        { cdr_record_id: "cdr_2", attempt_count: 2 },
      ])
      .mockResolvedValueOnce([]);
    executeRaw.mockResolvedValue(1);
    await expect(releaseFalselyParkedMisses(now)).resolves.toBe(2);
    const dues = executeRaw.mock.calls.map((call) =>
      (call as unknown[]).find((value) => value instanceof Date),
    );
    expect(dues).toEqual([nextAttemptAt(1, now), nextAttemptAt(2, now)]);
  });
});
