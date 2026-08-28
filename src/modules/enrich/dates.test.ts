import { describe, expect, it } from "vitest";
import {
  civilToExcelSerial,
  csvTimeToExcelSerial,
  parseCivilDateTime,
} from "@/modules/enrich/dates";

describe("naive civil datetime", () => {
  it("parses CSV timestamp", () => {
    expect(parseCivilDateTime("2026-08-01 00:00:19")).toEqual({
      year: 2026,
      month: 8,
      day: 1,
      hour: 0,
      minute: 0,
      second: 19,
    });
  });

  it("rejects invalid", () => {
    expect(parseCivilDateTime("not-a-date")).toBeNull();
  });

  it("converts to Excel serial without TZ shift", () => {
    const serial = civilToExcelSerial({
      year: 2026,
      month: 8,
      day: 1,
      hour: 0,
      minute: 0,
      second: 19,
    });
    expect(Math.floor(serial)).toBe(46235);
    expect(serial).toBeCloseTo(46235.0002199074, 8);
    expect(csvTimeToExcelSerial("2026-08-01 00:00:19")).toBeCloseTo(
      46235.0002199074,
      8,
    );
  });
});
