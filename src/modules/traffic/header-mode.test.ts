import { describe, expect, it } from "vitest";
import { trafficColumnHeaderMode } from "@/modules/traffic/header-mode";

describe("traffic column header", () => {
  it("keeps time sort on every screen and adds the OPRS menu", () => {
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
    ).toBe("sort-and-filter");
  });

  it("filters every OPRS column and leaves Calltrace plain elsewhere", () => {
    expect(
      trafficColumnHeaderMode({
        column: "voipmonitor_url_in",
        oprs: false,
        timeSortable: true,
        plain: true,
      }),
    ).toBe("text");
    expect(
      trafficColumnHeaderMode({
        column: "voipmonitor_url_in",
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
