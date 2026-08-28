import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format-count";

const NBSP = "\u202F";

describe("formatCount", () => {
  it("leaves small integers unchanged", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12)).toBe("12");
    expect(formatCount(999)).toBe("999");
  });

  it("groups thousands with U+202F", () => {
    expect(formatCount(125768)).toBe(`125${NBSP}768`);
    expect(formatCount(1_000_000)).toBe(`1${NBSP}000${NBSP}000`);
  });
});
