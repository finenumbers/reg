import { describe, expect, it } from "vitest";
import {
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
  DETAIL_WIDTHS,
  TRAFFIC_WIDTHS,
} from "@/modules/enrich/types";
import {
  detailBodyRole,
  detailHeaderRole,
  trafficBodyRole,
  trafficHeaderRole,
  xlsxMissFontRole,
} from "@/modules/enrich/xlsx-styles";

describe("traffic border roles", () => {
  it("boxes A/B number groups", () => {
    expect(trafficHeaderRole(1)).toBe("headerGroupStart");
    expect(trafficHeaderRole(2)).toBe("headerGroupEnd");
    expect(trafficBodyRole(1, false)).toBe("groupStart");
    expect(trafficBodyRole(2, true)).toBe("groupLastEnd");
    expect(trafficBodyRole(0, false)).toBe("noRight");
    expect(trafficBodyRole(6, false)).toBe("plain");
  });
});

describe("detail border roles", () => {
  it("boxes A-side, B-side, init geo, term geo", () => {
    expect(detailHeaderRole(1)).toBe("headerGroupStart");
    expect(detailHeaderRole(4)).toBe("headerGroupEnd");
    expect(detailBodyRole(14, false)).toBe("groupStart");
    expect(detailBodyRole(17, true)).toBe("groupLastEnd");
    expect(detailBodyRole(21, true)).toBe("groupLastEnd");
  });
});

describe("miss font", () => {
  it("colors only the miss phrases", () => {
    expect(xlsxMissFontRole(MISSING_BILLING_LABEL)).toBe("yellow");
    expect(xlsxMissFontRole(MISSING_PSTN_LABEL)).toBe("red");
    expect(xlsxMissFontRole("79501112233")).toBeNull();
    expect(xlsxMissFontRole("МТС")).toBeNull();
  });
});

describe("column widths", () => {
  it("matches the August 2026 sample", () => {
    expect(TRAFFIC_WIDTHS).toEqual([
      18.5, 15.1640625, 41.1640625, 15.1640625, 41.1640625, 13.83203125,
      13.1640625, 11.33203125, 15.33203125, 31.5, 32.5, 33.5, 37.5,
    ]);
    expect(DETAIL_WIDTHS).toEqual([
      18.5, 15.1640625, 41.1640625, 29.83203125, 29.83203125, 15.1640625,
      41.1640625, 29.83203125, 29.83203125, 13.83203125, 31.5, 32.5, 33.5,
      37.5, 20.5, 13.5, 21.1640625, 32.33203125, 18.5, 13.5, 21.1640625,
      32.33203125,
    ]);
  });
});
