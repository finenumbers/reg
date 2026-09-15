import { describe, expect, it } from "vitest";
import {
  reduceRegsUnregisteredWatch,
  type RegsUnregisteredWatchState,
} from "@/hooks/use-regs-unregistered-count";

const primed: RegsUnregisteredWatchState = {
  lastSuccessAt: "2026-09-15T00:00:00.000Z",
};

describe("reduceRegsUnregisteredWatch", () => {
  it("baselines lastSuccessAt on the first ok tick without a snapshot", () => {
    const result = reduceRegsUnregisteredWatch(
      { lastSuccessAt: undefined },
      {
        ok: true,
        unregisteredCount: 5,
        lastSuccessAt: "2026-09-15T00:00:00.000Z",
      },
    );
    expect(result.count).toBe(5);
    expect(result.snapshot).toBe(false);
    expect(result.next.lastSuccessAt).toBe("2026-09-15T00:00:00.000Z");
  });

  it("emits a snapshot when lastSuccessAt changes after baseline", () => {
    const result = reduceRegsUnregisteredWatch(primed, {
      ok: true,
      unregisteredCount: 3,
      lastSuccessAt: "2026-09-15T00:01:00.000Z",
    });
    expect(result.count).toBe(3);
    expect(result.snapshot).toBe(true);
    expect(result.next.lastSuccessAt).toBe("2026-09-15T00:01:00.000Z");
  });

  it("does not snapshot when only lastFinishedAt would have moved", () => {
    const result = reduceRegsUnregisteredWatch(primed, {
      ok: true,
      unregisteredCount: 5,
      lastSuccessAt: primed.lastSuccessAt ?? null,
    });
    expect(result.count).toBe(5);
    expect(result.snapshot).toBe(false);
  });

  it("still yields count on a failed tick without resetting N", () => {
    const result = reduceRegsUnregisteredWatch(primed, { ok: false });
    expect(result.count).toBeNull();
    expect(result.snapshot).toBe(false);
    expect(result.next).toEqual(primed);
  });

  it("updates count during pollInFlight but does not snapshot", () => {
    const result = reduceRegsUnregisteredWatch(
      primed,
      {
        ok: true,
        unregisteredCount: 1,
        lastSuccessAt: "2026-09-15T00:02:00.000Z",
      },
      { pollInFlight: true },
    );
    expect(result.count).toBe(1);
    expect(result.snapshot).toBe(false);
    expect(result.next.lastSuccessAt).toBe("2026-09-15T00:02:00.000Z");
  });

  it("snapshots the first success after never (null → timestamp)", () => {
    const result = reduceRegsUnregisteredWatch(
      { lastSuccessAt: null },
      {
        ok: true,
        unregisteredCount: 2,
        lastSuccessAt: "2026-09-15T00:03:00.000Z",
      },
    );
    expect(result.snapshot).toBe(true);
    expect(result.count).toBe(2);
  });
});
