import { describe, expect, it } from "vitest";
import { formatDatasetDate } from "@/modules/numbering-resource/format";

describe("formatDatasetDate", () => {
  it("uses the Moscow calendar day, including the 21:00 UTC boundary", () => {
    expect(formatDatasetDate("2026-10-31T20:59:59.000Z")).toBe("31.10.2026");
    expect(formatDatasetDate("2026-10-31T21:00:00.000Z")).toBe("01.11.2026");
  });

  it("shows a dash for an empty or unreadable instant", () => {
    expect(formatDatasetDate(null)).toBe("—");
    expect(formatDatasetDate(undefined)).toBe("—");
    expect(formatDatasetDate("")).toBe("—");
    expect(formatDatasetDate("   ")).toBe("—");
    expect(formatDatasetDate("not-a-date")).toBe("—");
  });
});
