import { describe, expect, it } from "vitest";
import {
  cdrMonthPrefix,
  civilNow,
  monthWindow,
  utcExportMonth,
  zonedCivilToUtc,
} from "@/lib/month-window";

describe("zonedCivilToUtc", () => {
  it("maps Moscow midnight to 21:00 UTC previous day", () => {
    const start = zonedCivilToUtc(2026, 8, 1, 0, 0, 0, "Europe/Moscow");
    expect(start.toISOString()).toBe("2026-07-31T21:00:00.000Z");
  });

  it("maps UTC midnight to itself", () => {
    const start = zonedCivilToUtc(2026, 8, 1, 0, 0, 0, "UTC");
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("monthWindow", () => {
  it("freezes previous month on 1 January", () => {
    const now = new Date("2026-01-15T10:00:00.000Z");
    const win = monthWindow("previous", "UTC", now);
    expect(win.year).toBe(2025);
    expect(win.month).toBe(12);
    expect(win.endInclusive).toBe(false);
    expect(win.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(win.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("uses current month until frozen now", () => {
    const now = new Date("2026-08-29T05:00:00.000Z");
    const win = monthWindow("current", "Europe/Moscow", now);
    expect(win.year).toBe(2026);
    expect(win.month).toBe(8);
    expect(win.endInclusive).toBe(true);
    expect(win.start.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(win.end).toBe(now);
  });

  it("reads civil clock in the display zone", () => {
    const now = new Date("2026-07-31T22:30:00.000Z");
    const moscow = civilNow("Europe/Moscow", now);
    expect(moscow.year).toBe(2026);
    expect(moscow.month).toBe(8);
    expect(moscow.day).toBe(1);
    const utc = civilNow("UTC", now);
    expect(utc.month).toBe(7);
    expect(utc.day).toBe(31);
  });
});

describe("utcExportMonth", () => {
  it("labels previous July and current August on 29 Aug UTC", () => {
    const now = new Date("2026-08-29T03:00:00.000Z");
    expect(utcExportMonth("previous", now)).toEqual({ year: 2026, month: 7 });
    expect(utcExportMonth("current", now)).toEqual({ year: 2026, month: 8 });
    expect(cdrMonthPrefix(2026, 6)).toBe("2026-06-");
    expect(cdrMonthPrefix(2026, 7)).toBe("2026-07-");
  });
});
