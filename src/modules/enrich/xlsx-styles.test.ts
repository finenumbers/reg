import { describe, expect, it } from "vitest";
import {
  detailBodyRole,
  detailFill,
  detailHeaderRole,
  trafficBodyRole,
  trafficFill,
  trafficHeaderRole,
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

describe("fills", () => {
  it("traffic: billing miss is yellow on number and side", () => {
    expect(trafficFill(1, true, false, false, false)).toBe("yellow");
    expect(trafficFill(2, true, false, false, false)).toBe("yellow");
    expect(trafficFill(3, true, false, false, false)).toBe("none");
  });

  it("traffic: PSTN miss is red on number; red wins over yellow", () => {
    expect(trafficFill(1, false, false, true, false)).toBe("red");
    expect(trafficFill(1, true, false, true, false)).toBe("red");
    expect(trafficFill(2, true, false, true, false)).toBe("yellow");
  });

  it("detail: PSTN miss paints operator/geo red", () => {
    expect(detailFill(1, false, false, true, false)).toBe("red");
    expect(detailFill(3, false, false, true, false)).toBe("red");
    expect(detailFill(4, false, false, true, false)).toBe("red");
    expect(detailFill(2, true, false, true, false)).toBe("yellow");
    expect(detailFill(1, true, false, true, false)).toBe("red");
  });
});
