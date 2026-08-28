import { describe, expect, it } from "vitest";
import {
  civilToUtcDate,
  csvTimeToDisplay,
  formatCivilDisplay,
  parseCivilDateTime,
  parseNaiveDateTime,
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

  it("formats as dd.MM.yyyy, HH:mm:ss without TZ shift", () => {
    expect(csvTimeToDisplay("2026-08-28 01:43:25")).toBe("28.08.2026, 01:43:25");
    expect(csvTimeToDisplay("2026-08-01 23:55:54")).toBe("01.08.2026, 23:55:54");
    expect(
      formatCivilDisplay({
        year: 2026,
        month: 8,
        day: 1,
        hour: 0,
        minute: 0,
        second: 19,
      }),
    ).toBe("01.08.2026, 00:00:19");
  });

  it("keeps the raw string when parsing fails", () => {
    expect(csvTimeToDisplay("not-a-date")).toBe("not-a-date");
  });

  it("packs civil digits as UTC without shifting", () => {
    expect(
      civilToUtcDate({
        year: 2026,
        month: 8,
        day: 27,
        hour: 20,
        minute: 4,
        second: 19,
      }).toISOString(),
    ).toBe("2026-08-27T20:04:19.000Z");
    expect(parseNaiveDateTime("2026-08-27 20:04:19")?.toISOString()).toBe(
      "2026-08-27T20:04:19.000Z",
    );
    expect(parseNaiveDateTime("2026-08-27T20:04:19.000Z")?.toISOString()).toBe(
      "2026-08-27T20:04:19.000Z",
    );
  });
});
