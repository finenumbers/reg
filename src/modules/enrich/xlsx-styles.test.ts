import { describe, expect, it } from "vitest";
import {
  DETAIL_HEADERS,
  DETAIL_WIDTHS,
  MISSING_BILLING_LABEL,
  MISSING_PSTN_LABEL,
  TRAFFIC_HEADERS,
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
  it("boxes A/B number groups after Дата/Время", () => {
    expect(trafficHeaderRole(0)).toBe("headerNoRight");
    expect(trafficHeaderRole(1)).toBe("headerNoRight");
    expect(trafficHeaderRole(2)).toBe("headerGroupStart");
    expect(trafficHeaderRole(3)).toBe("headerGroupEnd");
    expect(trafficBodyRole(0, false)).toBe("noRight");
    expect(trafficBodyRole(1, true)).toBe("noRight");
    expect(trafficBodyRole(2, false)).toBe("groupStart");
    expect(trafficBodyRole(3, true)).toBe("groupLastEnd");
    expect(trafficBodyRole(6, false)).toBe("noLeft");
    expect(trafficBodyRole(7, false)).toBe("plain");
  });
});

describe("detail border roles", () => {
  it("boxes A-side, B-side, init geo, term geo after Дата/Время", () => {
    expect(detailHeaderRole(0)).toBe("headerNoRight");
    expect(detailHeaderRole(1)).toBe("headerNoRight");
    expect(detailHeaderRole(2)).toBe("headerGroupStart");
    expect(detailHeaderRole(5)).toBe("headerGroupEnd");
    expect(detailBodyRole(15, false)).toBe("groupStart");
    expect(detailBodyRole(18, true)).toBe("groupLastEnd");
    expect(detailBodyRole(22, true)).toBe("groupLastEnd");
  });
});

describe("miss font", () => {
  it("colors only the miss phrases", () => {
    expect(xlsxMissFontRole(MISSING_BILLING_LABEL)).toBe("blue");
    expect(xlsxMissFontRole(MISSING_PSTN_LABEL)).toBe("red");
    expect(xlsxMissFontRole("79501112233")).toBeNull();
    expect(xlsxMissFontRole("МТС")).toBeNull();
  });
});

describe("column widths", () => {
  it("matches header count after splitting Дата and Время", () => {
    expect(TRAFFIC_WIDTHS).toHaveLength(TRAFFIC_HEADERS.length);
    expect(DETAIL_WIDTHS).toHaveLength(DETAIL_HEADERS.length);
    expect(TRAFFIC_WIDTHS).toEqual([
      12, 10, 15.1640625, 41.1640625, 15.1640625, 41.1640625, 13.83203125,
      13.1640625, 11.33203125, 15.33203125, 31.5, 32.5, 33.5, 37.5,
    ]);
    expect(DETAIL_WIDTHS).toEqual([
      12, 10, 15.1640625, 41.1640625, 29.83203125, 29.83203125, 15.1640625,
      41.1640625, 29.83203125, 29.83203125, 13.83203125, 31.5, 32.5, 33.5,
      37.5, 20.5, 13.5, 21.1640625, 32.33203125, 18.5, 13.5, 21.1640625,
      32.33203125,
    ]);
  });
});
