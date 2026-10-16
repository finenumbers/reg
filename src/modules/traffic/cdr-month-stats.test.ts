import { describe, expect, it } from "vitest";
import { monthMinutesRead } from "@/modules/traffic/cdr-month-stats";

const TTL = 60_000;

describe("monthMinutesRead", () => {
  it("returns a fresh value without a query", () => {
    expect(
      monthMinutesRead(
        1_000,
        "2026-10",
        {
          slot: { key: "2026-10", at: 900, minutes: 5 },
          failedKey: null,
          failedAt: null,
        },
        false,
        TTL,
      ),
    ).toEqual({ minutes: 5, startQuery: false });
  });

  it("keeps a stale value and starts one refresh", () => {
    expect(
      monthMinutesRead(
        70_000,
        "2026-10",
        {
          slot: { key: "2026-10", at: 0, minutes: 5 },
          failedKey: null,
          failedAt: null,
        },
        false,
        TTL,
      ),
    ).toEqual({ minutes: 5, startQuery: true });
  });

  it("does not scan during vacuum", () => {
    expect(
      monthMinutesRead(
        70_000,
        "2026-10",
        {
          slot: { key: "2026-10", at: 0, minutes: 5 },
          failedKey: null,
          failedAt: null,
        },
        true,
        TTL,
      ),
    ).toEqual({ minutes: 5, startQuery: false });
  });

  it("remembers a failure and does not hammer the database", () => {
    expect(
      monthMinutesRead(
        10_000,
        "2026-10",
        { slot: null, failedKey: "2026-10", failedAt: 9_000 },
        false,
        TTL,
      ),
    ).toEqual({ minutes: null, startQuery: false });
  });

  it("keeps the last total after a failed refresh", () => {
    expect(
      monthMinutesRead(
        10_000,
        "2026-10",
        {
          slot: { key: "2026-10", at: 0, minutes: 8 },
          failedKey: "2026-10",
          failedAt: 9_000,
        },
        false,
        TTL,
      ),
    ).toEqual({ minutes: 8, startQuery: false });
  });

  it("ignores another month's slot", () => {
    expect(
      monthMinutesRead(
        1_000,
        "2026-10",
        {
          slot: { key: "2026-09", at: 900, minutes: 5 },
          failedKey: null,
          failedAt: null,
        },
        false,
        TTL,
      ),
    ).toEqual({ minutes: null, startQuery: true });
  });
});
