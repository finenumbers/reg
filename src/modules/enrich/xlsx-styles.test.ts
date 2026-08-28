import { describe, expect, it } from "vitest";
import {
  detailBodyRole,
  detailHeaderRole,
  detailRedCols,
  trafficBodyRole,
  trafficHeaderRole,
  trafficRedCols,
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

describe("red columns", () => {
  it("marks traffic description misses", () => {
    expect([...trafficRedCols(true, false)].sort()).toEqual([1, 2]);
    expect([...trafficRedCols(false, true)].sort()).toEqual([3, 4]);
  });

  it("marks detail PSTN misses", () => {
    expect([...detailRedCols(true, false)].sort()).toEqual([1, 3, 4]);
    expect([...detailRedCols(false, true)].sort()).toEqual([5, 7, 8]);
  });
});
