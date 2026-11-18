import { describe, expect, it } from "vitest";
import { trafficColumnHeaderMode } from "@/modules/traffic/header-mode";

describe("traffic column header", () => {
  it("sorts time on every screen and keeps a filter when sort is not wired", () => {
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: false,
        timeSortable: true,
        durationSortable: false,
        plain: false,
      }),
    ).toBe("sort");
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: true,
        timeSortable: true,
        durationSortable: true,
        plain: false,
      }),
    ).toBe("sort");
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: true,
        timeSortable: false,
        durationSortable: false,
        plain: false,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: false,
        timeSortable: false,
        durationSortable: false,
        plain: false,
      }),
    ).toBe("filter");
  });

  it("sorts seconds only when that button is wired", () => {
    expect(
      trafficColumnHeaderMode({
        column: "elapsed_time",
        oprs: false,
        timeSortable: true,
        durationSortable: true,
        plain: false,
      }),
    ).toBe("sort");
    expect(
      trafficColumnHeaderMode({
        column: "elapsed_time",
        oprs: true,
        timeSortable: true,
        durationSortable: true,
        plain: false,
      }),
    ).toBe("sort");
    expect(
      trafficColumnHeaderMode({
        column: "elapsed_time",
        oprs: false,
        timeSortable: true,
        durationSortable: false,
        plain: false,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "term_elapsed_time",
        oprs: false,
        timeSortable: true,
        durationSortable: false,
        plain: false,
      }),
    ).toBe("filter");
  });

  it("keeps minutes and cost as labels on every screen", () => {
    for (const column of ["billable_minutes", "tariff_charge"]) {
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: false,
          timeSortable: true,
          durationSortable: true,
          plain: column === "billable_minutes",
        }),
      ).toBe("text");
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: true,
          timeSortable: true,
          durationSortable: true,
          plain: false,
        }),
      ).toBe("text");
    }
  });

  it("keeps Calltrace as a plain label and filters the other OPRS columns", () => {
    for (const column of ["voipmonitor_url_in", "voipmonitor_url_out"]) {
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: false,
          timeSortable: true,
          durationSortable: true,
          plain: true,
        }),
      ).toBe("text");
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: true,
          timeSortable: true,
          durationSortable: true,
          plain: true,
        }),
      ).toBe("text");
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: true,
          timeSortable: true,
          durationSortable: true,
          plain: false,
        }),
      ).toBe("text");
    }
    expect(
      trafficColumnHeaderMode({
        column: "rtp",
        oprs: true,
        timeSortable: true,
        durationSortable: true,
        plain: true,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "oprs_marking",
        oprs: true,
        timeSortable: true,
        durationSortable: true,
        plain: false,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "call_status",
        oprs: false,
        timeSortable: false,
        durationSortable: false,
        plain: false,
      }),
    ).toBe("filter");
  });
});
