import { describe, expect, it } from "vitest";
import { parseCityIds, parseCnt, parseDidList } from "@/modules/sipout/parse";

describe("sipout parse", () => {
  it("accepts a decimal cnt string and rejects a truncated list", () => {
    expect(parseCnt("2")).toBe(2);
    expect(parseCnt(0)).toBe(0);
    expect(parseCnt("02")).toBeNull();
    expect(parseCnt(-1)).toBeNull();
    expect(
      parseDidList({
        cnt: "1",
        list: [{ did: "74953084480" }, { did: "74953084481" }],
      }).ok,
    ).toBe(false);
  });

  it("reads every admissible did and keeps duplicates for the stage key", () => {
    const parsed = parseDidList({
      cnt: "2",
      list: [
        { did: "74953084480", price: "222", city_id: "41" },
        { did: "+74953084480", price: "333", city_id: "42" },
      ],
    });
    expect(parsed).toEqual({ ok: true, dids: ["74953084480", "74953084480"] });
  });

  it("rejects a city id that is not digits", () => {
    expect(parseCityIds({ cities: [{ id: "41" }, { id: "41" }, { id: "7" }] })).toEqual({
      ok: true,
      ids: ["41", "7"],
    });
    expect(parseCityIds({ cities: [{ id: "41" }, { id: "" }] }).ok).toBe(false);
    expect(parseCityIds({ cities: [] })).toEqual({ ok: true, ids: [] });
  });
});
