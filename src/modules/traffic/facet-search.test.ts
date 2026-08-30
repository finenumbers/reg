import { describe, expect, it } from "vitest";
import {
  cdrDateSearchNeedles,
  cdrDaySearchNeedles,
  cdrTimeSearchNeedles,
  displayDateQueryToRaw,
  facetSearchMatch,
  millisecondTokensForDisplayedSeconds,
  parseDisplayedSeconds,
} from "@/modules/traffic/facet-search";

describe("displayDateQueryToRaw", () => {
  it("maps display date and time to the stored civil string", () => {
    expect(displayDateQueryToRaw("28.12.2026, 01:23:43")).toBe(
      "2026-12-28 01:23:43",
    );
    expect(displayDateQueryToRaw("28.12.2026, 01:23")).toBe("2026-12-28 01:23");
    expect(displayDateQueryToRaw("28.12.2026")).toBe("2026-12-28");
    expect(displayDateQueryToRaw("8.2.2026")).toBe("2026-02-08");
  });

  it("maps day.month and month.year fragments", () => {
    expect(displayDateQueryToRaw("28.12")).toBe("-12-28");
    expect(displayDateQueryToRaw("12.2026")).toBe("2026-12");
  });

  it("rejects impossible calendar parts", () => {
    expect(displayDateQueryToRaw("32.12.2026")).toBeNull();
    expect(displayDateQueryToRaw("12.13")).toBeNull();
    expect(displayDateQueryToRaw("13.2026")).toBeNull();
  });
});

describe("cdrDateSearchNeedles", () => {
  it("keeps the raw query and adds a mapped display fragment", () => {
    expect(cdrDateSearchNeedles("28.12.2026")).toEqual([
      "28.12.2026",
      "2026-12-28",
    ]);
    expect(cdrDateSearchNeedles("2026-12-28")).toEqual(["2026-12-28"]);
    expect(cdrDateSearchNeedles("01:23")).toEqual(["01:23"]);
  });
});

describe("duration display seconds", () => {
  it("parses grouped second counts", () => {
    expect(parseDisplayedSeconds("10")).toBe(10);
    expect(parseDisplayedSeconds("1\u202F234")).toBe(1234);
    expect(parseDisplayedSeconds("n/a")).toBeNull();
  });

  it("lists millisecond tokens that ceil to those seconds", () => {
    expect(millisecondTokensForDisplayedSeconds(0)).toEqual(["0"]);
    expect(millisecondTokensForDisplayedSeconds(1)).toEqual(
      Array.from({ length: 1000 }, (_, i) => String(i + 1)),
    );
    expect(millisecondTokensForDisplayedSeconds(10)).toContain("9900");
    expect(millisecondTokensForDisplayedSeconds(10)).toContain("10000");
    expect(millisecondTokensForDisplayedSeconds(10)).not.toContain("9000");
  });
});

describe("cdrDaySearchNeedles", () => {
  it("maps display date without keeping a time suffix", () => {
    expect(cdrDaySearchNeedles("28.12.2026")).toEqual([
      "28.12.2026",
      "2026-12-28",
    ]);
    expect(cdrDaySearchNeedles("28.12.2026, 01:23:43")).toEqual([
      "28.12.2026, 01:23:43",
      "2026-12-28",
    ]);
    expect(cdrDaySearchNeedles("28.12")).toEqual(["28.12", "-12-28"]);
  });
});

describe("cdrTimeSearchNeedles", () => {
  it("keeps a typed clock and extracts time from a pasted datetime", () => {
    expect(cdrTimeSearchNeedles("14:22:52")).toEqual(["14:22:52"]);
    expect(cdrTimeSearchNeedles("14:22")).toEqual(["14:22"]);
    expect(cdrTimeSearchNeedles("28.12.2026, 01:23:43")).toEqual([
      "28.12.2026, 01:23:43",
      "01:23:43",
    ]);
  });
});

describe("facetSearchMatch", () => {
  it("uses contains needles for cdr_date display input", () => {
    expect(facetSearchMatch("cdr_date", "28.12.2026")).toEqual({
      kind: "contains",
      needles: ["28.12.2026", "2026-12-28"],
    });
  });

  it("uses date-only needles for cdr_day", () => {
    expect(facetSearchMatch("cdr_day", "28.12.2026, 01:23:43")).toEqual({
      kind: "contains",
      needles: ["28.12.2026, 01:23:43", "2026-12-28"],
    });
  });

  it("uses time-only needles for cdr_time", () => {
    expect(facetSearchMatch("cdr_time", "28.12.2026, 01:23:43")).toEqual({
      kind: "contains",
      needles: ["28.12.2026, 01:23:43", "01:23:43"],
    });
    expect(facetSearchMatch("cdr_time", "14:22")).toEqual({
      kind: "contains",
      needles: ["14:22"],
    });
  });

  it("matches duration by displayed seconds and the raw token", () => {
    const match = facetSearchMatch("elapsed_time", "10");
    expect(match.kind).toBe("in");
    if (match.kind !== "in") return;
    expect(match.values).toContain("10");
    expect(match.values).toContain("9900");
    expect(match.values).toHaveLength(1001);
  });

  it("falls back to contains for non-numeric duration search", () => {
    expect(facetSearchMatch("elapsed_time", "n/a")).toEqual({
      kind: "contains",
      needles: ["n/a"],
    });
  });

  it("leaves ordinary columns as raw contains", () => {
    expect(facetSearchMatch("side_a", "МТС")).toEqual({
      kind: "contains",
      needles: ["МТС"],
    });
  });
});
