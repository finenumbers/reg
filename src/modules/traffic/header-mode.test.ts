import { describe, expect, it } from "vitest";
import { trafficColumnHeaderMode } from "@/modules/traffic/header-mode";

describe("traffic column header", () => {
  it("sorts time on every screen and keeps a filter when sort is not wired", () => {
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: false,
        timeSortable: true,
        plain: false,
      }),
    ).toBe("sort");
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: true,
        timeSortable: true,
        plain: false,
      }),
    ).toBe("sort");
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: true,
        timeSortable: false,
        plain: false,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "cdr_time",
        oprs: false,
        timeSortable: false,
        plain: false,
      }),
    ).toBe("filter");
  });

  it("keeps Calltrace as a plain label and filters the other OPRS columns", () => {
    for (const column of ["voipmonitor_url_in", "voipmonitor_url_out"]) {
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: false,
          timeSortable: true,
          plain: true,
        }),
      ).toBe("text");
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: true,
          timeSortable: true,
          plain: true,
        }),
      ).toBe("text");
      expect(
        trafficColumnHeaderMode({
          column,
          oprs: true,
          timeSortable: true,
          plain: false,
        }),
      ).toBe("text");
    }
    expect(
      trafficColumnHeaderMode({
        column: "rtp",
        oprs: true,
        timeSortable: true,
        plain: true,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "oprs_marking",
        oprs: true,
        timeSortable: true,
        plain: false,
      }),
    ).toBe("filter");
    expect(
      trafficColumnHeaderMode({
        column: "call_status",
        oprs: false,
        timeSortable: false,
        plain: false,
      }),
    ).toBe("filter");
  });
});
