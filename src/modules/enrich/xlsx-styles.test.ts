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
  it("boxes A/B number groups after Дата/Время/Категория/Тип/Статус", () => {
    expect(trafficHeaderRole(0)).toBe("headerNoRight");
    expect(trafficHeaderRole(1)).toBe("headerNoRight");
    expect(trafficHeaderRole(2)).toBe("headerPlain");
    expect(trafficHeaderRole(3)).toBe("headerPlain");
    expect(trafficHeaderRole(4)).toBe("headerPlain");
    expect(trafficHeaderRole(5)).toBe("headerGroupStart");
    expect(trafficHeaderRole(6)).toBe("headerGroupEnd");
    expect(trafficBodyRole(0, false)).toBe("noRight");
    expect(trafficBodyRole(1, true)).toBe("noRight");
    expect(trafficBodyRole(2, false)).toBe("plain");
    expect(trafficBodyRole(5, false)).toBe("groupStart");
    expect(trafficBodyRole(6, true)).toBe("groupLastEnd");
    expect(trafficHeaderRole(9)).toBe("groupStart");
    expect(trafficBodyRole(9, false)).toBe("groupStart");
    expect(trafficBodyRole(9, true)).toBe("groupStart");
    expect(trafficBodyRole(10, false)).toBe("plain");
  });
});

describe("detail border roles", () => {
  it("boxes A-side, B-side, init geo, term geo after category and status", () => {
    expect(detailHeaderRole(0)).toBe("headerNoRight");
    expect(detailHeaderRole(1)).toBe("headerNoRight");
    expect(detailHeaderRole(2)).toBe("headerPlain");
    expect(detailHeaderRole(3)).toBe("headerPlain");
    expect(detailHeaderRole(4)).toBe("headerPlain");
    expect(detailHeaderRole(5)).toBe("headerGroupStart");
    expect(detailHeaderRole(8)).toBe("headerGroupEnd");
    expect(detailBodyRole(18, false)).toBe("groupStart");
    expect(detailBodyRole(21, true)).toBe("groupLastEnd");
    expect(detailBodyRole(25, true)).toBe("groupLastEnd");
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
      12, 11.5703125, 22, 18, 14, 15.140625, 41.140625, 15.140625, 41.140625,
      41.140625, 13.85546875, 13.140625, 11.28515625, 15.28515625, 31.42578125,
      32.42578125, 33.42578125, 37.42578125,
    ]);
    expect(DETAIL_WIDTHS).toEqual([
      12, 10, 22, 18, 14, 15.1640625, 41.1640625, 29.83203125, 29.83203125,
      15.1640625, 41.1640625, 29.83203125, 29.83203125, 13.83203125, 31.5, 32.5,
      33.5, 37.5, 20.5, 13.5, 21.1640625, 32.33203125, 18.5, 13.5, 21.1640625,
      32.33203125,
    ]);
  });
});
