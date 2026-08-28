import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import {
  displayTrafficFacet,
  formatCdrDateDisplay,
  formatTrafficCell,
} from "@/modules/traffic/ui-format";

describe("traffic UI date display", () => {
  it("reformats CDR civil time without shifting the clock", () => {
    expect(formatCdrDateDisplay("2026-12-28 01:23:43")).toBe(
      "28.12.2026, 01:23:43",
    );
    expect(formatCdrDateDisplay("2026-12-01 23:48:22")).toBe(
      "01.12.2026, 23:48:22",
    );
    expect(formatCdrDateDisplay("")).toBe("");
    expect(formatCdrDateDisplay("not-a-date")).toBe("not-a-date");
  });

  it("formats only cdr_date cells", () => {
    expect(formatTrafficCell("cdr_date", "2026-12-28 01:23:43")).toBe(
      "28.12.2026, 01:23:43",
    );
    expect(formatTrafficCell("bill_ani", "79001234567")).toBe("79001234567");
  });

  it("shows empty facet token as (пусто) and formats cdr_date facets", () => {
    expect(displayTrafficFacet("cdr_date", EMPTY_FILTER_TOKEN)).toBe(
      "(пусто)",
    );
    expect(displayTrafficFacet("cdr_date", "")).toBe("(пусто)");
    expect(displayTrafficFacet("cdr_date", "2026-12-28 01:23:43")).toBe(
      "28.12.2026, 01:23:43",
    );
    expect(displayTrafficFacet("bill_ani", "79001234567")).toBe("79001234567");
  });
});
