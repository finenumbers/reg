import { describe, expect, it } from "vitest";
import {
  CDR_DATE_CIVIL_REGEX,
  formatCdrDayDisplay,
  splitCdrDateParts,
} from "@/modules/traffic/cdr-date-parts";

function sqlSplit(raw: string): { day: string; time: string } {
  const trimmed = raw.trim();
  if (!new RegExp(CDR_DATE_CIVIL_REGEX).test(trimmed)) {
    return { day: "", time: "" };
  }
  return {
    day: trimmed.slice(0, 10),
    time: trimmed.slice(11, 19),
  };
}

describe("splitCdrDateParts", () => {
  it("splits space-separated civil clock like SQL left/substring", () => {
    expect(splitCdrDateParts("2026-08-30 14:22:52")).toEqual({
      day: "2026-08-30",
      time: "14:22:52",
    });
    expect(splitCdrDateParts("2026-08-30 00:00:19")).toEqual({
      day: "2026-08-30",
      time: "00:00:19",
    });
  });

  it("accepts T and drops fractional seconds via slice(11, 19)", () => {
    expect(splitCdrDateParts("2026-08-30T14:22:52.123")).toEqual({
      day: "2026-08-30",
      time: "14:22:52",
    });
  });

  it("matches SQL left(10) / substring(from 12 for 8) on fixtures", () => {
    const fixtures = [
      "2026-08-30 14:22:52",
      "2026-08-30T14:22:52.123",
      "2026-12-01 23:48:22",
      "",
      "not-a-date",
    ];
    for (const raw of fixtures) {
      expect(splitCdrDateParts(raw)).toEqual(sqlSplit(raw));
    }
  });

  it("returns empty parts for blank or garbage", () => {
    expect(splitCdrDateParts("")).toEqual({ day: "", time: "" });
    expect(splitCdrDateParts("  ")).toEqual({ day: "", time: "" });
    expect(splitCdrDateParts("not-a-date")).toEqual({ day: "", time: "" });
    expect(splitCdrDateParts("2026-08-30")).toEqual({ day: "", time: "" });
  });
});

describe("formatCdrDayDisplay", () => {
  it("formats stored ISO day without a time part", () => {
    expect(formatCdrDayDisplay("2026-08-30")).toBe("30.08.2026");
    expect(formatCdrDayDisplay("2026-12-01")).toBe("01.12.2026");
  });

  it("leaves empty and garbage unchanged", () => {
    expect(formatCdrDayDisplay("")).toBe("");
    expect(formatCdrDayDisplay("not-a-date")).toBe("not-a-date");
  });
});

describe("CDR_DATE_CIVIL_REGEX", () => {
  it("is an unanchored prefix so fractional seconds still match", () => {
    expect(CDR_DATE_CIVIL_REGEX.startsWith("^")).toBe(true);
    expect(CDR_DATE_CIVIL_REGEX.endsWith("$")).toBe(false);
    expect(new RegExp(CDR_DATE_CIVIL_REGEX).test("2026-08-30 14:22:52.1")).toBe(
      true,
    );
  });
});
