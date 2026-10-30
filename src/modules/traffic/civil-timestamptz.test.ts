import { describe, expect, it } from "vitest";
import { isAcceptableCivilClock } from "@/modules/traffic/civil-timestamptz";

describe("isAcceptableCivilClock", () => {
  it("accepts a real clock and a fractional suffix", () => {
    expect(isAcceptableCivilClock("2026-08-30 14:22:52")).toBe(true);
    expect(isAcceptableCivilClock("2026-08-30 14:22:52.1")).toBe(true);
    expect(isAcceptableCivilClock("2024-02-29 00:00:00")).toBe(true);
    expect(isAcceptableCivilClock("2000-02-29 00:00:00")).toBe(true);
  });

  it("rejects a calendar PostgreSQL cannot store", () => {
    expect(isAcceptableCivilClock("2026-02-31 12:00:00")).toBe(false);
    expect(isAcceptableCivilClock("2026-02-28 25:00:00")).toBe(false);
    expect(isAcceptableCivilClock("2026-02-29 00:00:00")).toBe(false);
    expect(isAcceptableCivilClock("1900-02-29 00:00:00")).toBe(false);
    expect(isAcceptableCivilClock("2026-00-10 00:00:00")).toBe(false);
    expect(isAcceptableCivilClock("0000-01-01 00:00:00")).toBe(false);
  });
});
